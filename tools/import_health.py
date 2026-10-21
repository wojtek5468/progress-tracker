#!/usr/bin/env python3
"""Merge an Apple Health export (export.xml / eksport.xml) into the seed JSON.

Usage:
    python3 tools/import_health.py path/to/eksport.xml data/seed.json

Adds birth date and sex to the profile, body measurements (weight, body fat,
lean mass), daily steps / sleep / resting HR / active kcal, and Health
workouts. Values the spreadsheet already had are kept; Health fills the rest.
"""
import argparse
import collections
import datetime as dt
import json
import sys
import xml.etree.ElementTree as ET

ASLEEP = {
    "HKCategoryValueSleepAnalysisAsleep",
    "HKCategoryValueSleepAnalysisAsleepUnspecified",
    "HKCategoryValueSleepAnalysisAsleepCore",
    "HKCategoryValueSleepAnalysisAsleepDeep",
    "HKCategoryValueSleepAnalysisAsleepREM",
}
IN_BED = "HKCategoryValueSleepAnalysisInBed"
BODY = {
    "HKQuantityTypeIdentifierBodyMass": "weightKg",
    "HKQuantityTypeIdentifierBodyFatPercentage": "bodyFatPct",
    "HKQuantityTypeIdentifierLeanBodyMass": "leanMassKg",
}
DAILY_SUM = {
    "HKQuantityTypeIdentifierStepCount": "steps",
    "HKQuantityTypeIdentifierActiveEnergyBurned": "activeKcal",
}


def ts(s):
    return dt.datetime.strptime(s, "%Y-%m-%d %H:%M:%S %z")


def merged_minutes(intervals):
    total, end = 0.0, None
    for s, e in sorted(intervals):
        if end is None or s > end:
            total += (e - s).total_seconds()
            end = e
        elif e > end:
            total += (e - end).total_seconds()
            end = e
    return total / 60


def to_kg(value, unit):
    return value * 0.45359237 if unit == "lb" else value


def nutrition_targets(profile, logs, days=90):
    """Mifflin-St Jeor BMR + measured activity from the last `days` of Health data."""
    age = (dt.date.today() - dt.date.fromisoformat(profile["birthDate"])).days // 365
    bmr = 10 * profile["weightKg"] + 6.25 * profile["heightCm"] - 5 * age + (5 if profile["sex"] == "male" else -161)
    recent = [l for l in logs[-days:] if "activeKcal" in l]
    active = sum(l["activeKcal"] for l in recent) / len(recent) if recent else 0.35 * bmr
    steps = [l["steps"] for l in logs[-days:] if "steps" in l]
    avg_steps = sum(steps) / len(steps) if steps else 0
    profile["activityLevel"] = "sedentary" if avg_steps < 5000 else "light" if avg_steps < 7500 else "moderate"
    # Thermic effect of food adds roughly 10% on top of BMR + activity.
    maintenance = round((bmr + active) * 1.1 / 50) * 50
    reduction = maintenance - 500
    protein = round(1.8 * profile["weightKg"] / 5) * 5
    fat = round(0.9 * profile["weightKg"] / 5) * 5
    carbs = round((reduction - protein * 4 - fat * 9) / 4 / 5) * 5
    return {
        "bmrKcal": round(bmr), "avgActiveKcal": round(active), "avgSteps": round(avg_steps),
        "maintenanceKcal": maintenance, "reductionKcal": reduction,
        "proteinG": protein, "fatG": fat, "carbsG": carbs,
        "method": f"Mifflin-St Jeor + średnia aktywność z {days} dni (Zdrowie), deficyt 500 kcal",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xml")
    ap.add_argument("seed")
    a = ap.parse_args()

    me = {}
    body = collections.defaultdict(dict)
    sums = collections.defaultdict(lambda: collections.defaultdict(float))  # (day, field) -> source -> sum
    sleep = collections.defaultdict(lambda: collections.defaultdict(list))  # (day, kind) -> source -> intervals
    resting = {}
    workouts = []

    for _, el in ET.iterparse(a.xml, events=("end",)):
        tag = el.tag
        if tag == "Me":
            me = dict(el.attrib)
        elif tag == "Record":
            t = el.get("type")
            if t in BODY:
                day = el.get("startDate")[:10]
                v = float(el.get("value"))
                if t == "HKQuantityTypeIdentifierBodyFatPercentage" and v <= 1:
                    v *= 100
                elif t != "HKQuantityTypeIdentifierBodyFatPercentage":
                    v = to_kg(v, el.get("unit"))
                body[day][BODY[t]] = round(v, 1)
            elif t in DAILY_SUM:
                day = el.get("startDate")[:10]
                sums[(day, DAILY_SUM[t])][el.get("sourceName")] += float(el.get("value"))
            elif t == "HKQuantityTypeIdentifierRestingHeartRate":
                resting[el.get("startDate")[:10]] = round(float(el.get("value")))
            elif t == "HKCategoryTypeIdentifierSleepAnalysis":
                v = el.get("value")
                kind = "asleep" if v in ASLEEP else "inBed" if v == IN_BED else None
                if kind:
                    s, e = ts(el.get("startDate")), ts(el.get("endDate"))
                    # A night belongs to the day you wake up (sleep after 18:00 counts toward the next day).
                    day = (e + dt.timedelta(hours=6)).date().isoformat()
                    sleep[(day, kind)][el.get("sourceName")].append((s, e))
            el.clear()
        elif tag == "Workout":
            kcal = None
            for st in el.iter("WorkoutStatistics"):
                if st.get("type") == "HKQuantityTypeIdentifierActiveEnergyBurned":
                    kcal = round(float(st.get("sum")))
            workouts.append({
                "start": ts(el.get("startDate")).isoformat(),
                "type": el.get("workoutActivityType").replace("HKWorkoutActivityType", ""),
                "durationMin": round(float(el.get("duration")), 1),
                "activeKcal": kcal,
                "source": el.get("sourceName"),
            })
            el.clear()

    with open(a.seed, encoding="utf-8") as f:
        seed = json.load(f)

    profile = seed["profile"]
    dob = me.get("HKCharacteristicTypeIdentifierDateOfBirth")
    if dob:
        profile["birthDate"] = dob
        profile["birthYear"] = int(dob[:4])
    sex = me.get("HKCharacteristicTypeIdentifierBiologicalSex", "")
    if sex in ("HKBiologicalSexMale", "HKBiologicalSexFemale"):
        profile["sex"] = sex.removeprefix("HKBiologicalSex").lower()

    # Several devices record the same steps; take the source with the highest total per day.
    daily = collections.defaultdict(dict)
    for (day, field), by_source in sums.items():
        daily[day][field] = round(max(by_source.values()))
    days_with_sleep = {d for d, _ in sleep}
    for day in days_with_sleep:
        by_source = sleep.get((day, "asleep")) or sleep.get((day, "inBed"))
        minutes = max(merged_minutes(iv) for iv in by_source.values())
        if minutes >= 60:
            daily[day]["sleepMin"] = round(minutes)
    for day, bpm in resting.items():
        daily[day]["restingHr"] = bpm

    existing = {l["date"]: l for l in seed.get("dailyLogs", [])}
    for day, vals in daily.items():
        entry = existing.setdefault(day, {"date": day})
        for k, v in vals.items():
            entry.setdefault(k, v)
    seed["dailyLogs"] = sorted(existing.values(), key=lambda l: l["date"])

    seed["bodyMeasurements"] = [dict(date=d, **v) for d, v in sorted(body.items())]
    unique = {(w["start"], w["type"]): w for w in workouts}
    seed["healthWorkouts"] = [{k: v for k, v in w.items() if v is not None}
                              for _, w in sorted(unique.items())]

    seed["nutrition"]["targets"] = nutrition_targets(profile, seed["dailyLogs"])

    with open(a.seed, "w", encoding="utf-8") as f:
        json.dump(seed, f, ensure_ascii=False, indent=1)

    print(f"profile={profile} body={len(seed['bodyMeasurements'])} "
          f"dailyLogs={len(seed['dailyLogs'])} workouts={len(seed['healthWorkouts'])}", file=sys.stderr)


if __name__ == "__main__":
    main()
