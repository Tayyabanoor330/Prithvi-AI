# train_aqi_model.py
# Synthetic prototype: MQ-2 + MQ-135 + environmental sensors -> AQI regression

from pathlib import Path

import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

MODEL_DIR = Path(__file__).resolve().parent
DATASET = MODEL_DIR / "synthetic_environmental_aqi_10000.csv"
OUTPUT = MODEL_DIR / "aqi_edge_random_forest.pkl"

df = pd.read_csv(DATASET)
df = df.drop(columns=["rain_mm"], errors="ignore")

FEATURES = [
    "temperature_C",
    "humidity_percent",
    "MQ2_raw",
    "MQ135_raw",
]
TARGET = "AQI"

X = df[FEATURES]
y = df[TARGET]

# Keep a completely unseen test set.
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.20, random_state=42
)

model = RandomForestRegressor(
    n_estimators=30,
    max_depth=8,
    min_samples_leaf=3,
    random_state=42,
    n_jobs=-1,
)

model.fit(X_train, y_train)

pred = model.predict(X_test)

mae = mean_absolute_error(y_test, pred)
rmse = mean_squared_error(y_test, pred) ** 0.5
r2 = r2_score(y_test, pred)

print("=== AQI MODEL RESULTS ===")
print(f"MAE  : {mae:.2f} AQI")
print(f"RMSE : {rmse:.2f} AQI")
print(f"R²   : {r2:.3f}")

# Save model for later conversion/deployment.
joblib.dump(
    {"model": model, "features": FEATURES},
    OUTPUT,
)

