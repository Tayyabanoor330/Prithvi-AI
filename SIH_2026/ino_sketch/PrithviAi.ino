#include <DHT.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

#include "flood_model.h"
#include "aqi_model.h"

// ============================================================
// WIFI / BACKEND
// ============================================================

const char* WIFI_SSID = "Airtel_ibra_3538";
const char* WIFI_PASSWORD = "Zainab@66";
const char* BACKEND_URL = "http://192.168.1.100:3000/api/readings";

const unsigned long SEND_INTERVAL_MS = 5000;
unsigned long lastSendMs = 0;

// ============================================================
// SENSOR PINS
// ============================================================

#define DHT_PIN 14
#define DHT_TYPE DHT11

#define MQ2_PIN 32
#define MQ135_PIN 33

#define RAIN_PIN 35
#define SOIL_PIN 34

#define TRIG_PIN 25
#define ECHO_PIN 26

#define BUZZER_PIN 4
#define LED_PIN 23

DHT dht(DHT_PIN, DHT_TYPE);

// ============================================================
// FLOOD MODEL / SENSOR CALIBRATION
// ============================================================

// Physical height of the prototype water container
const float MODEL_HEIGHT_CM = 9.0;

// ESP32 ADC maximum for the current configuration
const float ADC_MAX = 4095.0;

// ============================================================
// WATER LEVEL
// ============================================================

float getWaterDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);

  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);

  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);

  if (duration == 0) {
    return -1;
  }

  float distance = duration * 0.0343 / 2.0;

  return distance;
}

// ============================================================
// RAW SENSOR → MODEL FEATURE CONVERSION
// ============================================================

// Rain sensor:
// Current dry reading ≈ 4095
// Wet reading becomes lower.
//
// Converts:
//     raw 4095 → 0%
//     raw 0    → 100%
float convertRainToPercent(int rainRaw) {

  float rainIntensity =
      ((ADC_MAX - (float)rainRaw) / ADC_MAX) * 100.0;

  return constrain(rainIntensity, 0.0, 100.0);
}


// Soil sensor:
// Current dry reading ≈ 4095
// Wet reading becomes lower.
//
// Converts:
//     raw 4095 → 0%
//     raw 0    → 100%
float convertSoilToPercent(int soilRaw) {

  float soilMoisture =
      ((ADC_MAX - (float)soilRaw) / ADC_MAX) * 100.0;

  return constrain(soilMoisture, 0.0, 100.0);
}

// ============================================================
// CATEGORY FUNCTIONS
// ============================================================

String floodCategory(float risk) {

  if (risk < 25.0) {
    return "Low";
  }

  if (risk < 50.0) {
    return "Moderate";
  }

  if (risk < 75.0) {
    return "High";
  }

  return "Critical";
}


String aqiCategory(float aqi) {

  if (aqi <= 50.0) {
    return "Good";
  }

  if (aqi <= 100.0) {
    return "Satisfactory";
  }

  if (aqi <= 200.0) {
    return "Moderate";
  }

  if (aqi <= 300.0) {
    return "Poor";
  }

  if (aqi <= 400.0) {
    return "Very Poor";
  }

  return "Severe";
}

// ============================================================
// WIFI
// ============================================================

void connectToWifi() {

  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  WiFi.mode(WIFI_STA);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  Serial.print("Connecting to WiFi");

  while (WiFi.status() != WL_CONNECTED) {

    delay(500);

    Serial.print(".");
  }

  Serial.println();

  Serial.print("WiFi connected. IP: ");

  Serial.println(WiFi.localIP());
}

// ============================================================
// SEND TELEMETRY
// ============================================================

void sendTelemetry(
    float temperature,
    float humidity,
    int mq2Raw,
    int mq135Raw,
    int rainRaw,
    int soilRaw,
    float rainIntensity,
    float soilMoisture,
    float waterDistance,
    float waterLevel,
    float floodRisk,
    const String& floodStatus,
    float aqi,
    const String& aqiStatus,
    bool alert
) {

  if (WiFi.status() != WL_CONNECTED) {
    connectToWifi();
  }

  StaticJsonDocument<1024> payload;

  // ----------------------------------------------------------
  // ENVIRONMENT
  // ----------------------------------------------------------

  if (isnan(temperature)) {
    payload["temperature"] = nullptr;
  }
  else {
    payload["temperature"] = temperature;
  }

  if (isnan(humidity)) {
    payload["humidity"] = nullptr;
  }
  else {
    payload["humidity"] = humidity;
  }

  // ----------------------------------------------------------
  // RAW POLLUTION SENSOR VALUES
  // ----------------------------------------------------------

  payload["mq2Raw"] = mq2Raw;
  payload["mq135Raw"] = mq135Raw;

  // ----------------------------------------------------------
  // RAW FLOOD SENSOR VALUES
  // ----------------------------------------------------------

  payload["rainRaw"] = rainRaw;
  payload["soilRaw"] = soilRaw;

  // ----------------------------------------------------------
  // FLOOD MODEL INPUTS
  // ----------------------------------------------------------

  payload["rainIntensity"] = rainIntensity;
  payload["soilMoisture"] = soilMoisture;

  if (waterDistance >= 0) {
    payload["waterDistance"] = waterDistance;
  }
  else {
    payload["waterDistance"] = nullptr;
  }

  payload["waterLevel"] = waterLevel;

  // ----------------------------------------------------------
  // EDGE AI RESULTS
  // ----------------------------------------------------------

  payload["floodRisk"] = floodRisk;
  payload["floodCategory"] = floodStatus;

  payload["aqi"] = aqi;
  payload["aqiCategory"] = aqiStatus;

  // ----------------------------------------------------------
  // ALERT
  // ----------------------------------------------------------

  payload["alert"] = alert;

  // ----------------------------------------------------------
  // JSON SERIALIZATION
  // ----------------------------------------------------------

  String body;

  serializeJson(payload, body);

  // ----------------------------------------------------------
  // HTTP POST
  // ----------------------------------------------------------

  HTTPClient http;

  http.begin(BACKEND_URL);

  http.addHeader("Content-Type", "application/json");

  int statusCode = http.POST(body);

  Serial.print("HTTP POST status: ");
  Serial.println(statusCode);

  Serial.print("Payload: ");
  Serial.println(body);

  http.end();
}

// ============================================================
// SETUP
// ============================================================

void setup() {

  Serial.begin(115200);

  dht.begin();

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);

  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);

  connectToWifi();

  Serial.println();
  Serial.println("==========================================");
  Serial.println(" AI ENVIRONMENTAL MONITORING SYSTEM");
  Serial.println(" ESP32 EDGE AI SENSOR SYSTEM");
  Serial.println("==========================================");
  Serial.println();

  delay(2000);
}

// ============================================================
// MAIN LOOP
// ============================================================

void loop() {

  // ==========================================================
  // 1. READ SENSORS
  // ==========================================================

  float temperature = dht.readTemperature();

  float humidity = dht.readHumidity();

  int mq2Raw = analogRead(MQ2_PIN);

  int mq135Raw = analogRead(MQ135_PIN);

  int rainRaw = analogRead(RAIN_PIN);

  int soilRaw = analogRead(SOIL_PIN);

  float waterDistance = getWaterDistance();


  // ==========================================================
  // 2. CALCULATE WATER LEVEL
  // ==========================================================

  float waterLevel = 0.0;

  if (waterDistance >= 0) {

    waterLevel = MODEL_HEIGHT_CM - waterDistance;

    if (waterLevel < 0) {
      waterLevel = 0;
    }

    if (waterLevel > MODEL_HEIGHT_CM) {
      waterLevel = MODEL_HEIGHT_CM;
    }
  }


  // ==========================================================
  // 3. CONVERT FLOOD SENSOR VALUES
  // ==========================================================

  float rainIntensity =
      convertRainToPercent(rainRaw);

  float soilMoisture =
      convertSoilToPercent(soilRaw);


  // ==========================================================
  // 4. PREPARE FLOOD MODEL INPUT
  // ==========================================================

  int16_t floodFeatures[5];

  floodFeatures[0] =
      isnan(temperature) ? 0 : (int16_t)round(temperature);

  floodFeatures[1] =
      isnan(humidity) ? 0 : (int16_t)round(humidity);

  floodFeatures[2] =
      (int16_t)round(rainIntensity);

  floodFeatures[3] =
      (int16_t)round(soilMoisture);

  floodFeatures[4] =
      (int16_t)round(waterLevel);


  // ==========================================================
  // 5. FLOOD EDGE AI INFERENCE
  // ==========================================================

  float floodRisk =
      flood_model_predict(
          floodFeatures,
          5
      );

  floodRisk = constrain(
      floodRisk,
      0.0,
      100.0
  );

  String floodStatus =
      floodCategory(floodRisk);


  // ==========================================================
  // 6. PREPARE AQI MODEL INPUT
  // ==========================================================

  int16_t aqiFeatures[4];

  aqiFeatures[0] =
      isnan(temperature) ? 0 : (int16_t)round(temperature);

  aqiFeatures[1] =
      isnan(humidity) ? 0 : (int16_t)round(humidity);

  aqiFeatures[2] =
      (int16_t)mq2Raw;

  aqiFeatures[3] =
      (int16_t)mq135Raw;


  // ==========================================================
  // 7. AQI EDGE AI INFERENCE
  // ==========================================================

  float aqi =
      aqi_model_predict(
          aqiFeatures,
          4
      );

  if (aqi < 0) {
    aqi = 0;
  }

  String aqiStatus =
      aqiCategory(aqi);


  // ==========================================================
  // 8. ALERT LOGIC
  // ==========================================================

  bool floodAlert =
      floodRisk >= 50.0;

  bool pollutionAlert =
      aqi > 100.0;

  bool alert =
      floodAlert || pollutionAlert;


  // ==========================================================
  // 9. HARDWARE ALERT
  // ==========================================================

  if (alert) {

    digitalWrite(LED_PIN, HIGH);

    digitalWrite(BUZZER_PIN, HIGH);
  }
  else {

    digitalWrite(LED_PIN, LOW);

    digitalWrite(BUZZER_PIN, LOW);
  }


  // ==========================================================
  // 10. SERIAL MONITOR
  // ==========================================================

  Serial.println();
  Serial.println("==========================================");
  Serial.println(" SENSOR READINGS");
  Serial.println("==========================================");

  Serial.print("Temperature (C): ");
  Serial.println(temperature);

  Serial.print("Humidity (%): ");
  Serial.println(humidity);

  Serial.print("MQ-2 raw: ");
  Serial.println(mq2Raw);

  Serial.print("MQ-135 raw: ");
  Serial.println(mq135Raw);

  Serial.print("Rain raw: ");
  Serial.println(rainRaw);

  Serial.print("Rain intensity (%): ");
  Serial.println(rainIntensity);

  Serial.print("Soil raw: ");
  Serial.println(soilRaw);

  Serial.print("Soil moisture (%): ");
  Serial.println(soilMoisture);

  Serial.print("Water distance (cm): ");
  Serial.println(waterDistance);

  Serial.print("Water level (cm): ");
  Serial.println(waterLevel);


  // ==========================================================
  // 11. EDGE AI OUTPUT
  // ==========================================================

  Serial.println();
  Serial.println("==========================================");
  Serial.println(" EDGE AI INFERENCE");
  Serial.println("==========================================");

  Serial.println("--- FLOOD MODEL ---");

  Serial.print("Flood risk: ");
  Serial.print(floodRisk, 1);
  Serial.println("/100");

  Serial.print("Flood category: ");
  Serial.println(floodStatus);

  Serial.println();

  Serial.println("--- AQI MODEL ---");

  Serial.print("Predicted AQI: ");
  Serial.println(aqi, 1);

  Serial.print("AQI category: ");
  Serial.println(aqiStatus);

  Serial.println();

  Serial.print("ALERT: ");
  Serial.println(alert ? "YES" : "NO");


  // ==========================================================
  // 12. SEND DATA TO BACKEND
  // ==========================================================

  if (millis() - lastSendMs >= SEND_INTERVAL_MS) {

    lastSendMs = millis();

    sendTelemetry(
        temperature,
        humidity,
        mq2Raw,
        mq135Raw,
        rainRaw,
        soilRaw,
        rainIntensity,
        soilMoisture,
        waterDistance,
        waterLevel,
        floodRisk,
        floodStatus,
        aqi,
        aqiStatus,
        alert
    );
  }

  delay(2000);
}