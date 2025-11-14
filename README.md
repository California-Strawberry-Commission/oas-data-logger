# Operator Aid Systems Data Collection

## Objective

A common, fast and reliable method for data collection for Operator Aid Systems, such as bug vac and spray rig.

We continuously gather data from connected sensors, and save it to an SD card. When connected to WiFi, the data is uploaded to a server. We provide a web-based interface to visualize the data.

## Hardware

### v0

The [Adafruit ItsyBitsy ESP32](https://learn.adafruit.com/adafruit-itsybitsy-esp32/overview) was ultimately selected due to its small form factor, relatively large number of GPIO pins, power management, Wi-Fi and Bluetooth capabilities, and I2C connector. We had originally worked with the Sparkfun Thing Plus. However, the ItsyBitsy has a smaller size, extra power management features, and better isolation between the VCC and battery rails. With the Sparkfun Thing Plus, we needed to mod in a better diode onto the board to get USB power detection to work, and found that GPS did not work on I2C (and thus had to use UART).

Relevant features include:

- USB to serial converter chip
- Power regulator
- STEMMA QT I2C connector (which we use for the GPS module)
- Low power (light sleep at 4mA, deep sleep at ~10uA)
- Wi-Fi and Bluetooth
- 20 GPIO pins
- SPI pins (which we use for the MicroSD module)
- User switch
- Small form factor

The GPS module provides support for GPS, GLONASS, GALILEO, and QZSS, providing updates at up to 10 Hz and with both UART and I2C interfaces.

### v1

See https://github.com/California-Strawberry-Commission/oas-data-logger-hardware

## Software

### ESP32

`oas-logger` is a PlatformIO (IDE for embedded systems, based on VSCode) project for the ESP32 to log data from various attached sensors (currently only GPS) using the Arduino API. It depends on `dlflib`, which is used for writing and uploading log data.

### Server

`data-visualizer` is a Next.js app deployed on Vercel for uploading and visualizing OAS data. It depends on `dlflib-js`, which is used for parsing `.dlf` files, and so we use an npm workspace.

See [README.md](software/data-visualizer/README.md).
