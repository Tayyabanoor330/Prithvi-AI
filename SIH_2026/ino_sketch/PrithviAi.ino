#include <Arduino.h>
#include <DHT.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <math.h>
#include <ArduinoJson.h>

#include "flood_model.h"
#include "aqi_model.h"

// Set these for your network. BACKEND_URL must use the computer's LAN IPv4,
// not localhost, because the ESP32 is a separate device.
const char *WIFI_SSID = "YOUR_WIFI_SSID";
const char *WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char *DEVICE_TOKEN = "PASTE_THE_SERVER_DEVICE_TOKEN_HERE";
const char *BACKEND_URL = "http://YOUR_COMPUTER_LAN_IP:3000/api/readings";

constexpr unsigned long SEND_INTERVAL_MS = 5000;
constexpr unsigned long WIFI_RETRY_INTERVAL_MS = 10000;
constexpr float EMPTY_DISTANCE_CM = 7.72f;
constexpr float MAX_WATER_LEVEL_CM = 7.72f;
constexpr float ADC_MAX = 4095.0f;
constexpr uint8_t WATER_SAMPLE_COUNT = 3;

constexpr int DHT_PIN = 14;
constexpr int MQ2_PIN = 32;
constexpr int MQ135_PIN = 33;
constexpr int RAIN_PIN = 35;
constexpr int SOIL_PIN = 34;
constexpr int TRIG_PIN = 25;
constexpr int ECHO_PIN = 26;
constexpr int BUZZER_PIN = 4;
constexpr int LED_PIN = 23;

#define DHT_TYPE DHT11

DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSendMs = 0;
unsigned long lastWifiAttemptMs = 0;
float lastValidWaterLevelCm = 0.0f;
bool hasValidWaterReading = false;

float readOneWaterDistanceCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(3);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  const unsigned long durationUs = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (durationUs == 0) return -1.0f;

  const float distanceCm = durationUs * 0.0343f / 2.0f;
  if (!isfinite(distanceCm) || distanceCm < 2.0f || distanceCm > 400.0f) {
    return -1.0f;
  }
  return distanceCm;
}

float readWaterDistanceCm() {
  float samples[WATER_SAMPLE_COUNT];
  uint8_t validCount = 0;

  for (uint8_t i = 0; i < WATER_SAMPLE_COUNT; ++i) {
    const float value = readOneWaterDistanceCm();
    if (value >= 0.0f) samples[validCount++] = value;
    if (i + 1 < WATER_SAMPLE_COUNT) delay(55);
  }

  if (validCount == 0) return -1.0f;

  // Sort the small sample set and return its median to reject single echoes.
  for (uint8_t i = 0; i < validCount; ++i) {
    for (uint8_t j = i + 1; j < validCount; ++j) {
      if (samples[j] < samples[i]) {
        const float temp = samples[i];
        samples[i] = samples[j];
        samples[j] = temp;
      }
    }
  }
  return samples[validCount / 2];
}

float waterLevelFromDistance(float distanceCm) {
  if (!isfinite(distanceCm) || distanceCm < 0.0f) return -1.0f;
  return constrain(EMPTY_DISTANCE_CM - distanceCm, 0.0f, MAX_WATER_LEVEL_CM);
}

float toPercent(int rawValue) {
  return constrain((ADC_MAX - rawValue) * 100.0f / ADC_MAX, 0.0f, 100.0f);
}

String floodCategory(float risk) {
  if (risk < 25.0f) return "Low";
  if (risk < 50.0f) return "Moderate";
  if (risk < 75.0f) return "High";
  return "Critical";
}

String aqiCategory(float aqi) {
  if (aqi <= 50.0f) return "Good";
  if (aqi <= 100.0f) return "Satisfactory";
  if (aqi <= 200.0f) return "Moderate";
  if (aqi <= 300.0f) return "Poor";
  if (aqi <= 400.0f) return "Very Poor";
  return "Severe";
}

void startWifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  lastWifiAttemptMs = millis();
  Serial.println("Connecting to Wi-Fi; sensor sampling will continue meanwhile.");
}

void maintainWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  if (millis() - lastWifiAttemptMs < WIFI_RETRY_INTERVAL_MS) return;

  lastWifiAttemptMs = millis();
  Serial.println("Wi-Fi disconnected; retrying.");
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void sendTelemetry(float temperature, float humidity, int mq2Raw, int mq135Raw,
                   int rainRaw, int soilRaw, float rainPercent, float soilPercent,
                   float waterDistanceCm, bool waterValid, float waterLevelCm,
                   float floodRisk, const String &floodStatus, float aqi,
                   const String &aqiStatus, bool alert) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("HTTP skipped: ESP32 is not connected to Wi-Fi.");
    return;
  }

  JsonDocument payload;
  payload["source"] = "esp32";
  if (isfinite(temperature)) payload["temperature"] = temperature;
  else payload["temperature"] = nullptr;
  if (isfinite(humidity)) payload["humidity"] = humidity;
  else payload["humidity"] = nullptr;

  payload["mq2Raw"] = mq2Raw;
  payload["mq135Raw"] = mq135Raw;
  payload["rainRaw"] = rainRaw;
  payload["soilRaw"] = soilRaw;
  payload["rainIntensity"] = rainPercent;
  payload["soilMoisture"] = soilPercent;
  payload["waterValid"] = waterValid;
  if (waterValid) {
    payload["waterDistanceCm"] = waterDistanceCm;
    payload["waterLevelCm"] = waterLevelCm;
    payload["waterPercent"] = waterLevelCm * 100.0f / MAX_WATER_LEVEL_CM;
  } else {
    payload["waterDistanceCm"] = nullptr;
    payload["waterLevelCm"] = nullptr;
    payload["waterPercent"] = nullptr;
  }
  payload["floodRisk"] = floodRisk;
  payload["floodCategory"] = floodStatus;
  payload["aqi"] = aqi;
  payload["aqiCategory"] = aqiStatus;
  payload["alert"] = alert;

  String body;
  serializeJson(payload, body);

  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(3000);
  if (!http.begin(BACKEND_URL)) {
    Serial.println("HTTP error: could not initialize the backend URL.");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-Device-Token", DEVICE_TOKEN);
  const int statusCode = http.POST(body);
  Serial.printf("POST %s -> HTTP %d\n", BACKEND_URL, statusCode);
  if (statusCode < 200 || statusCode >= 300) {
    Serial.println(http.getString());
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);
  analogSetPinAttenuation(MQ2_PIN, ADC_11db);
  analogSetPinAttenuation(MQ135_PIN, ADC_11db);
  analogSetPinAttenuation(RAIN_PIN, ADC_11db);
  analogSetPinAttenuation(SOIL_PIN, ADC_11db);

  dht.begin();
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(TRIG_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  startWifi();

  Serial.println("ESP32 environmental monitor ready.");
  Serial.println("Check ECHO voltage divider and shared GND if water readings are invalid.");
}

void loop() {
  maintainWifi();

  const float temperature = dht.readTemperature();
  const float humidity = dht.readHumidity();
  const int mq2Raw = analogRead(MQ2_PIN);
  const int mq135Raw = analogRead(MQ135_PIN);
  const int rainRaw = analogRead(RAIN_PIN);
  const int soilRaw = analogRead(SOIL_PIN);

  const float waterDistanceCm = readWaterDistanceCm();
  const bool waterValid = waterDistanceCm >= 0.0f;
  if (waterValid) {
    lastValidWaterLevelCm = waterLevelFromDistance(waterDistanceCm);
    hasValidWaterReading = true;
  }
  // Keep model input stable during echo loss, but never publish the fallback
  // as a measured value. The payload carries waterValid=false in that case.
  const float waterLevelCm = hasValidWaterReading ? lastValidWaterLevelCm : 0.0f;

  const float rainPercent = toPercent(rainRaw);
  const float soilPercent = toPercent(soilRaw);
  int16_t floodFeatures[5] = {
    static_cast<int16_t>(isfinite(temperature) ? roundf(temperature) : 0),
    static_cast<int16_t>(isfinite(humidity) ? roundf(humidity) : 0),
    static_cast<int16_t>(roundf(rainPercent)),
    static_cast<int16_t>(roundf(soilPercent)),
    static_cast<int16_t>(roundf(waterLevelCm))
  };
  float floodRisk = constrain(flood_model_predict(floodFeatures, 5), 0.0f, 100.0f);
  const String floodStatus = floodCategory(floodRisk);

  int16_t aqiFeatures[4] = {
    static_cast<int16_t>(isfinite(temperature) ? roundf(temperature) : 0),
    static_cast<int16_t>(isfinite(humidity) ? roundf(humidity) : 0),
    static_cast<int16_t>(mq2Raw),
    static_cast<int16_t>(mq135Raw)
  };
  float aqi = constrain(aqi_model_predict(aqiFeatures, 4), 0.0f, 500.0f);
  const String aqiStatus = aqiCategory(aqi);
  const bool alert = floodRisk >= 50.0f || aqi > 100.0f;
  digitalWrite(LED_PIN, alert ? HIGH : LOW);
  digitalWrite(BUZZER_PIN, alert ? HIGH : LOW);

  Serial.println();
  Serial.printf("Temp: %.1f C | Humidity: %.1f %%\n", temperature, humidity);
  Serial.printf("MQ2: %d | MQ135: %d | Rain: %.1f %% | Soil: %.1f %%\n",
                mq2Raw, mq135Raw, rainPercent, soilPercent);
  if (waterValid) {
    Serial.printf("Water distance: %.2f cm | Water level: %.2f cm\n",
                  waterDistanceCm, waterLevelCm);
  } else {
    Serial.printf("Water sensor ERROR (no valid echo); last measured level: %.2f cm\n",
                  waterLevelCm);
  }
  Serial.printf("Flood: %.1f (%s) | AQI: %.1f (%s) | Alert: %s\n",
                floodRisk, floodStatus.c_str(), aqi, aqiStatus.c_str(), alert ? "YES" : "NO");
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("Wi-Fi IP: %s | RSSI: %d dBm\n",
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
  }

  if (millis() - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = millis();
    sendTelemetry(temperature, humidity, mq2Raw, mq135Raw, rainRaw, soilRaw,
                  rainPercent, soilPercent, waterDistanceCm, waterValid,
                  waterLevelCm, floodRisk, floodStatus, aqi, aqiStatus, alert);
  }
  delay(2000);
}