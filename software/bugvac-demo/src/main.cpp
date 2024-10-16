/*
Usage instructions:
Module will automatically power up and begin logging whenever power is applied through USB.
It will automatically save data and shut down safely when power is removed.

To override the shutdown (IE to offload data when tractor is unpowered) press the reset button
To sleep the ESP at any time, press the BOOT button.
*/

#include <Arduino.h>
#include <ESP32Time.h>
#include <FS.h>
#include <FastLED.h>
#include <SD.h>
#include <TinyGPS++.h>
#include <dlf_logger.h>

#define PIN_VUSB_SENSE GPIO_NUM_27
#define PIN_GOTO_SLEEP GPIO_NUM_0
#define PIN_STRING_POT GPIO_NUM_34

CRGB leds[1];
TinyGPSPlus gps;
ESP32Time rtc;

uint32_t data_time = 0;
uint16_t string_pot = 0xAAAA;
struct {
    double lat;
    double lng;
    double alt;
    uint32_t satellites;
} pos;

CSCLogger logger(SD);
run_handle_t r = 0;

bool offload_mode = false;

void setup_logger() {
    WATCH(logger, data_time);

    auto sat_log_interval = std::chrono::seconds(5);
    POLL(logger, pos.satellites, sat_log_interval);

    auto pos_log_interval = std::chrono::seconds(1);
    POLL(logger, pos.lat, pos_log_interval);
    POLL(logger, pos.lng, pos_log_interval);
    POLL(logger, pos.alt, pos_log_interval);

    auto string_pot_interval = std::chrono::milliseconds(100);
    POLL(logger, string_pot, string_pot_interval);

    logger.begin();
}

void update_gps_vals() {
    if (gps.date.isUpdated() && gps.time.isUpdated()) {
        // Set RTC epoch time so files get created w/ correct timestamp.
        rtc.setTime(gps.time.second(), gps.time.minute(), gps.time.hour(), gps.date.day(), gps.date.month(), gps.date.year());
    }

    if (gps.satellites.isUpdated()) {
        pos.satellites = gps.satellites.value();
    }

    if (gps.location.isUpdated()) {
        pos.lat = gps.location.lat();
        pos.lng = gps.location.lng();
        pos.alt = gps.altitude.meters();
    }
}

void wait_sd() {
    SPI.begin(18, 19, 23);
    while (!SD.begin(5)) {
        FastLED.showColor(CRGB::Red);
        delay(500);
        FastLED.showColor(CRGB::Black);
        delay(500);
    }
    Serial.println("Card connected!");
}

void wait_valid_time() {
    while (!(data_time = rtc.getEpoch())) {
        FastLED.showColor(CRGB::Orange);
        delay(500);
        FastLED.showColor(CRGB::Black);
        delay(500);
    }
    Serial.println("Valid time received!");
}

// Reads GPS data and updates local state.
void task_gps(void* args) {
    Serial1.begin(9600, SERIAL_8N1, 22, 21);
    while (true) {
        // Read GPS
        while (Serial1.available())
            if (gps.encode(Serial1.read()))
                update_gps_vals();

        delay(100);
    }
}

//
bool has_usb_power() {
    return digitalRead(PIN_VUSB_SENSE);
}

// Monitors for shutdown conditions
// Puts ESP into deep sleep when conditions are met.
void task_shutdown_monitor(void* args) {
    static bool vusb_sleep_armed = false;

    delay(5000);

    while (true) {
        bool io0_sleep = !digitalRead(PIN_GOTO_SLEEP);

        bool usb_sleep = !offload_mode && !has_usb_power();

        // make sure USB power is gone for 2 cycles before triggering sleep.
        if (io0_sleep || (usb_sleep && vusb_sleep_armed))
            break;

        vusb_sleep_armed = usb_sleep;

        delay(1000);
    }

    Serial.println("GOING TO SLEEP!");
    // Finish up run
    if (r)
        logger.stop_run(r);

    SD.end();

    // turn off GPS by turning off qwiic power
    pinMode(0, OUTPUT);
    digitalWrite(0, LOW);

    // Turn off LED
    FastLED.showColor(CRGB::Black);

    // Wake when USB is plugged in.
    if (!has_usb_power())
        esp_sleep_enable_ext0_wakeup(PIN_VUSB_SENSE, 1);

    // go to deep sleep.
    esp_deep_sleep_start();

    vTaskDelete(NULL);
    return;
}

void offload_init() {
    FastLED.showColor(CRGB::YellowGreen);  // overriden wake (battery + reset)
    offload_mode = true;

    init();

    wait_sd();
    setup_logger();

    FastLED.showColor(CRGB::HotPink);  // overriden wake (battery + reset)

    FastLED.showColor(CRGB::Blue);  // standard wake

    // TODO: setup logger w/ offload capabilities.
}

void standard_init() {
    init();

    xTaskCreate(task_gps, "gps", 4096, NULL, 5, NULL);
    pinMode(PIN_STRING_POT, INPUT);

    wait_sd();
    wait_valid_time();
    setup_logger();

    double m = 0;
    r = logger.start_run(Encodable(m, "double"));  //, std::chrono::seconds(1)

    FastLED.showColor(CRGB::Green);
}

void init() {
    logger
        .wifi("test_net", "12345678")
        .syncTo("812.us.to", 9235);

    xTaskCreate(task_shutdown_monitor, "shutdown_mon", 4096, NULL, 5, NULL);
}

void setup() {
    FastLED.addLeds<WS2812, 2, GRB>(leds, 1);
    FastLED.setBrightness(10);

    Serial.begin(115200);
    FastLED.showColor(CRGB::White);  // standard wake

    Serial.println("Starting in 2s...");
    delay(2000);

    // check startup mode. If not woken b/c of USB connection,
    // go into sleep overriden mode.
    pinMode(PIN_VUSB_SENSE, INPUT_PULLDOWN);
    pinMode(PIN_GOTO_SLEEP, INPUT_PULLUP);
    if (!has_usb_power()) {
        offload_init();
    } else {
        standard_init();
    }
}

void loop()  // Writes GPS data to the Serial port with a baud rate of 115200
{
    string_pot = analogRead(PIN_STRING_POT);
    delay(100);
}
