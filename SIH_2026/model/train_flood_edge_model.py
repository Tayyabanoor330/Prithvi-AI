from pathlib import Path
import joblib
import pandas as pd

from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split


# ============================================================
# PATHS
# ============================================================

MODEL_DIR = Path(__file__).resolve().parent

DATASET = MODEL_DIR / "prototype_synthetic_flood_10000.csv"
OUTPUT = MODEL_DIR / "flood_edge_random_forest.pkl"


# ============================================================
# FEATURES
# ============================================================

FEATURES = [
    "temperature_C",
    "humidity_percent",
    "rain_intensity_percent",
    "soil_moisture_percent",
    "water_level_cm",
]

TARGET = "Flood_Risk"


# ============================================================
# LOAD DATASET
# ============================================================

df = pd.read_csv(DATASET)

required_columns = FEATURES + [TARGET]

missing_columns = [
    column
    for column in required_columns
    if column not in df.columns
]

if missing_columns:
    raise ValueError(
        f"Missing required flood columns: {missing_columns}"
    )


X = df[FEATURES]
y = df[TARGET]


# ============================================================
# TRAIN / TEST SPLIT
# ============================================================

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y,
    test_size=0.20,
    random_state=42,
)


# ============================================================
# EDGE RANDOM FOREST
# ============================================================

model = RandomForestRegressor(
    n_estimators=30,
    max_depth=8,
    min_samples_leaf=3,
    random_state=42,
    n_jobs=-1,
)

model.fit(X_train, y_train)


# ============================================================
# EVALUATION
# ============================================================

pred = model.predict(X_test)

mae = mean_absolute_error(y_test, pred)

rmse = mean_squared_error(
    y_test,
    pred
) ** 0.5

r2 = r2_score(y_test, pred)


print("\n========================================")
print("FLOOD EDGE MODEL RESULTS")
print("========================================")

print(f"MAE  : {mae:.2f} risk points")
print(f"RMSE : {rmse:.2f} risk points")
print(f"R²   : {r2:.3f}")


# ============================================================
# FEATURE IMPORTANCE
# ============================================================

print("\n=== FEATURE IMPORTANCE ===")

for feature, importance in sorted(
    zip(FEATURES, model.feature_importances_),
    key=lambda item: item[1],
    reverse=True,
):
    print(f"{feature}: {importance:.3f}")


# ============================================================
# TEST PHYSICAL PROTOTYPE CONDITIONS
# ============================================================

test_conditions = pd.DataFrame([
    {
        "temperature_C": 23,
        "humidity_percent": 50,
        "rain_intensity_percent": 10,
        "soil_moisture_percent": 10,
        "water_level_cm": 0,
    },
    {
        "temperature_C": 23,
        "humidity_percent": 75,
        "rain_intensity_percent": 50,
        "soil_moisture_percent": 50,
        "water_level_cm": 4,
    },
    {
        "temperature_C": 23,
        "humidity_percent": 90,
        "rain_intensity_percent": 80,
        "soil_moisture_percent": 80,
        "water_level_cm": 6,
    },
    {
        "temperature_C": 23,
        "humidity_percent": 95,
        "rain_intensity_percent": 100,
        "soil_moisture_percent": 100,
        "water_level_cm": 8,
    },
    {
        "temperature_C": 23,
        "humidity_percent": 100,
        "rain_intensity_percent": 100,
        "soil_moisture_percent": 100,
        "water_level_cm": 9,
    },
])

test_predictions = model.predict(test_conditions)


def flood_category(risk):

    if risk < 25:
        return "Low"

    if risk < 50:
        return "Moderate"

    if risk < 75:
        return "High"

    return "Critical"


print("\n=== PROTOTYPE TEST CONDITIONS ===")

for i, (row, risk) in enumerate(
    zip(
        test_conditions.to_dict("records"),
        test_predictions,
    ),
    start=1,
):

    risk = float(risk)

    print(
        f"Test {i}: "
        f"Water={row['water_level_cm']:.1f} cm, "
        f"Rain={row['rain_intensity_percent']:.0f}%, "
        f"Soil={row['soil_moisture_percent']:.0f}% "
        f"-> Risk={risk:.1f} "
        f"({flood_category(risk)})"
    )


# ============================================================
# SAVE MODEL
# ============================================================

joblib.dump(
    {
        "model": model,
        "features": FEATURES,
        "target": TARGET,
        "categories": {
            "low": "0-24.9",
            "moderate": "25-49.9",
            "high": "50-74.9",
            "critical": "75-100",
        },
    },
    OUTPUT,
)


print("\n========================================")
print("MODEL SAVED")
print("========================================")
print(OUTPUT)