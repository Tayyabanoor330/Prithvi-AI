from pathlib import Path
import numpy as np
import pandas as pd

# ============================================================
# SETTINGS
# ============================================================

SEED = 42
N_SAMPLES = 10000

OUTPUT = (
    Path(__file__).resolve().parent
    / "prototype_synthetic_flood_10000.csv"
)

rng = np.random.default_rng(SEED)


# ============================================================
# GENERATE SENSOR CONDITIONS
# ============================================================

temperature = rng.uniform(20, 40, N_SAMPLES)

humidity = rng.uniform(40, 100, N_SAMPLES)

rain = rng.uniform(0, 100, N_SAMPLES)

soil = rng.uniform(0, 100, N_SAMPLES)

# IMPORTANT:
# Physical prototype maximum = 9 cm
water = rng.uniform(0, 9, N_SAMPLES)


# ============================================================
# WATER-LEVEL RISK
# ============================================================

# Strong nonlinear relationship.
#
# 0 cm  -> ~0
# 3 cm  -> ~20
# 4 cm  -> ~35
# 5 cm  -> ~50
# 6 cm  -> ~70
# 7 cm  -> ~85
# 8 cm  -> ~95
# 9 cm  -> 100
#
# Water level is intentionally the dominant signal.

water_norm = water / 9.0

water_risk = (
    100
    * (
        0.55 * water_norm
        + 0.45 * (water_norm ** 2)
    )
)


# ============================================================
# RAIN CONTRIBUTION
# ============================================================

# Rain is an amplifier rather than the main signal.

rain_factor = rain / 100.0

rain_effect = (
    18
    * rain_factor
    * (0.35 + 0.65 * water_norm)
)


# ============================================================
# SOIL MOISTURE CONTRIBUTION
# ============================================================

# Wet soil increases risk, especially once water is already rising.

soil_factor = soil / 100.0

soil_effect = (
    12
    * soil_factor
    * (0.30 + 0.70 * water_norm)
)


# ============================================================
# HUMIDITY CONTRIBUTION
# ============================================================

humidity_factor = np.clip(
    (humidity - 40) / 60,
    0,
    1
)

humidity_effect = (
    5
    * humidity_factor
    * water_norm
)


# ============================================================
# EARLY FLOOD INTERACTION
# ============================================================

# Heavy rain + wet soil becomes particularly important
# once water is already accumulating.

combined_environment = (
    (rain / 100)
    * (soil / 100)
    * water_norm
)

interaction_effect = (
    12 * combined_environment
)


# ============================================================
# TOTAL RISK
# ============================================================

risk = (
    water_risk
    + rain_effect
    + soil_effect
    + humidity_effect
    + interaction_effect
)


# ============================================================
# EXTRA ESCALATION ABOVE 5 CM
# ============================================================

# Once water crosses 5 cm, risk should accelerate sharply.

high_water = np.maximum(water - 5.0, 0)

escalation = (
    high_water / 4.0
) * (
    10
    + 8 * rain_factor
    + 6 * soil_factor
)

risk += escalation


# ============================================================
# SENSOR / ENVIRONMENTAL VARIATION
# ============================================================

noise = rng.normal(
    0,
    1.5,
    N_SAMPLES
)

risk += noise


# ============================================================
# CLAMP
# ============================================================

risk = np.clip(
    risk,
    0,
    100
)


# ============================================================
# GUARANTEE REPRESENTATION OF PROTOTYPE STATES
# ============================================================

# We deliberately create many samples around the actual
# physical demo range so the Random Forest sees those states
# during training.

demo_indices = rng.choice(
    N_SAMPLES,
    size=2000,
    replace=False
)


# ------------------------------------------------------------
# DEMO STATE 1: LOW WATER
# ------------------------------------------------------------

idx = demo_indices[:400]

water[idx] = rng.uniform(0.0, 1.5, len(idx))
rain[idx] = rng.uniform(0, 25, len(idx))
soil[idx] = rng.uniform(0, 30, len(idx))
humidity[idx] = rng.uniform(40, 70, len(idx))


# ------------------------------------------------------------
# DEMO STATE 2: MODERATE WATER
# ------------------------------------------------------------

idx = demo_indices[400:800]

water[idx] = rng.uniform(2.0, 4.0, len(idx))
rain[idx] = rng.uniform(20, 60, len(idx))
soil[idx] = rng.uniform(25, 65, len(idx))
humidity[idx] = rng.uniform(55, 85, len(idx))


# ------------------------------------------------------------
# DEMO STATE 3: HIGH WATER
# ------------------------------------------------------------

idx = demo_indices[800:1200]

water[idx] = rng.uniform(4.0, 6.0, len(idx))
rain[idx] = rng.uniform(45, 85, len(idx))
soil[idx] = rng.uniform(50, 90, len(idx))
humidity[idx] = rng.uniform(70, 100, len(idx))


# ------------------------------------------------------------
# DEMO STATE 4: CRITICAL WATER
# ------------------------------------------------------------

idx = demo_indices[1200:1600]

water[idx] = rng.uniform(6.0, 7.5, len(idx))
rain[idx] = rng.uniform(60, 100, len(idx))
soil[idx] = rng.uniform(65, 100, len(idx))
humidity[idx] = rng.uniform(75, 100, len(idx))


# ------------------------------------------------------------
# DEMO STATE 5: EXTREME WATER
# ------------------------------------------------------------

idx = demo_indices[1600:2000]

water[idx] = rng.uniform(7.5, 9.0, len(idx))
rain[idx] = rng.uniform(70, 100, len(idx))
soil[idx] = rng.uniform(75, 100, len(idx))
humidity[idx] = rng.uniform(80, 100, len(idx))


# ============================================================
# RECALCULATE RISK FOR DEMO STATES
# ============================================================

water_norm = water / 9.0

water_risk = (
    100
    * (
        0.55 * water_norm
        + 0.45 * (water_norm ** 2)
    )
)

rain_factor = rain / 100.0

rain_effect = (
    18
    * rain_factor
    * (0.35 + 0.65 * water_norm)
)

soil_factor = soil / 100.0

soil_effect = (
    12
    * soil_factor
    * (0.30 + 0.70 * water_norm)
)

humidity_factor = np.clip(
    (humidity - 40) / 60,
    0,
    1
)

humidity_effect = (
    5
    * humidity_factor
    * water_norm
)

combined_environment = (
    (rain / 100)
    * (soil / 100)
    * water_norm
)

interaction_effect = (
    12 * combined_environment
)

high_water = np.maximum(water - 5.0, 0)

escalation = (
    high_water / 4.0
) * (
    10
    + 8 * rain_factor
    + 6 * soil_factor
)

risk = (
    water_risk
    + rain_effect
    + soil_effect
    + humidity_effect
    + interaction_effect
    + escalation
    + rng.normal(0, 1.5, N_SAMPLES)
)

risk = np.clip(risk, 0, 100)


# ============================================================
# CREATE DATAFRAME
# ============================================================

df = pd.DataFrame({
    "temperature_C": np.round(temperature, 2),
    "humidity_percent": np.round(humidity, 2),
    "rain_intensity_percent": np.round(rain, 2),
    "soil_moisture_percent": np.round(soil, 2),
    "water_level_cm": np.round(water, 2),
    "Flood_Risk": np.round(risk, 2),
})


# ============================================================
# SAVE
# ============================================================

df.to_csv(
    OUTPUT,
    index=False
)


# ============================================================
# REPORT
# ============================================================

print("========================================")
print("PROTOTYPE FLOOD DATASET GENERATED")
print("========================================")

print(f"Rows: {len(df)}")
print(f"Saved to: {OUTPUT}")

print("\nFeature ranges:")

for column in df.columns:
    print(
        f"{column}: "
        f"{df[column].min():.2f} -> "
        f"{df[column].max():.2f}"
    )


print("\nRisk distribution:")

print(
    f"Low      (<25)   : { (df['Flood_Risk'] < 25).sum() }"
)

print(
    f"Moderate (25-50) : { (((df['Flood_Risk'] >= 25) & (df['Flood_Risk'] < 50)).sum()) }"
)

print(
    f"High     (50-75) : { (((df['Flood_Risk'] >= 50) & (df['Flood_Risk'] < 75)).sum()) }"
)

print(
    f"Critical (75+)   : { (df['Flood_Risk'] >= 75).sum() }"
)


# ============================================================
# WATER-LEVEL CHECK
# ============================================================

print("\n=== WATER LEVEL CHECK ===")

for level in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]:

    closest = (
        df.iloc[
            (df["water_level_cm"] - level)
            .abs()
            .argsort()[:100]
        ]
    )

    print(
        f"{level} cm -> "
        f"average risk "
        f"{closest['Flood_Risk'].mean():.1f}"
    )


print("\nDataset generation complete.")