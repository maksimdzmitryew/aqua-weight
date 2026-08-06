### High-Level Implementation Plan for ESP32 Smart Scales

Based on the project's existing FastAPI backend and your hardware requirements, here is a brief high-level implementation plan for the IoT part using MicroPython on ESP32.


#### 1. Hardware Prototyping (Breadboard)
*   **Sensors:** Use your external weight sensors (load cells). You will likely need an **HX711** load cell amplifier/ADC to interface with the ESP32, as load cell signals are too small for the built-in ADC.
*   **Wiring:** 
    *   Connect the load cell to the HX711.
    *   Connect the HX711 (VCC, GND, DT, SCK) to the ESP32.
*   **Power:** Power the ESP32 via USB or a regulated power source during prototyping.

#### 2. MicroPython Firmware Development
*   **Environment:** Flash the latest MicroPython firmware to your ESP32.
*   **WiFi & Auth:**
    *   Implement a connection utility to join your local WiFi.
    *   Use the `urequests` (or `requests`) library to communicate with the backend.
    *   **Authentication:** The backend currently supports Bearer tokens or a static API Key (via `X-API-Key` header). For IoT devices, a long-lived API key or a dedicated token is recommended.
*   **Sensor Logic:**
    *   Use a MicroPython HX711 library to read raw values.
    *   Implement a simple calibration script to convert raw values to grams.
*   **Data Transmission:**
    *   Define the `plant_id` (ULID) for the plant being weighed.
    *   Send a `POST` request to `http://<backend-ip>/plants/<plant_id>/measurements/weight`.
    *   Payload format (JSON): `{"measured_at": "ISO8601_TIMESTAMP", "measured_weight_g": 1234}`.

#### 3. Backend Integration
*   **API Compatibility:** Use the existing `POST /plants/{plant_id}/measurements/weight` endpoint.
*   **Metadata:** Consider using the `scale_id` field in the payload to track which device sent the data.
*   **Endpoints:**
    *   `POST /plants/{plant_id}/measurements/weight`: For regular weight checks.
    *   `POST /plants/{plant_id}/measurements/watering`: If you implement a "watering detected" logic on the scale (sudden weight increase).

#### 4. Verification & Testing
*   **Local Loop:** Test the scale by placing a known weight and checking the backend database/UI for the update.
*   **Power Management:** Once functional, implement `machine.deepsleep()` on the ESP32 to save power, waking up only for scheduled measurements.

#### 5. Next Steps for Production
*   **PCB/Housing:** Move from breadboard to a soldered protoboard or custom PCB.
*   **Enclosure:** 3D print or adapt a case for the load cells to create a stable weighing platform.
