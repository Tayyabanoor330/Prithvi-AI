/* Same-origin polling bridge from the ESP32 telemetry API to the sensor engine. */

(function(){
  const READINGS_URL = "/api/readings";
  const POLL_INTERVAL_MS = 3000;

  async function pollReadings(){
    try{
      const response = await fetch(READINGS_URL, {cache:"no-store"});
      if(!response.ok) throw new Error("Telemetry API returned HTTP " + response.status);
      const payload = await response.json();
      if(payload.source !== "esp32"){
        const device = PRITHVI.sensors.getState().device;
        PRITHVI.sensors.setHardwareStatus(device.updatedAt ? "offline" : "waiting",
          device.updatedAt ? "No current ESP32 packet is available." : "Waiting for the first ESP32 packet.");
        return;
      }
      PRITHVI.sensors.ingestHardware(payload);
    }catch{
      PRITHVI.sensors.setHardwareStatus("offline", "Backend unavailable; check the Node server connection.");
    }
  }

  document.addEventListener("DOMContentLoaded", ()=>{
    pollReadings();
    window.setInterval(pollReadings, POLL_INTERVAL_MS);
    window.addEventListener("online", pollReadings);
  });
})();