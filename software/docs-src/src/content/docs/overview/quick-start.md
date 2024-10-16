---
title: Quick-Start
description: Get started as fast as possible
---

## DLFLib Quick-Start
DLFLib is designed to be as simple as possible to use, so you can focus on what's important for your project.

## Requirements
At the moment, DLFLib requires:
- An ESP32-series microcontroller
- A connected SD card ([See here for how to set that up](https://randomnerdtutorials.com/esp32-microsd-card-arduino/))

## Installation

### Platformio
Install the latest version of the library
```sh
pio install https://github.com/DominicChm/daq-2023.git
```

## Basic Example
Say you want to add some DAQ to Arduino's basic `Blink` sketch to track wether the LED is on or off. Lets start with the basic `blink.cpp` code:
### Setup
To supercharge this program with DLFLib, we first need to make sure there's a variable in the program tracking the value we want to log. 
For `Blink`, this means we need to create a variable (lets call it `is_led_on`) to track the LED's state.

```diff lang="c++"
#include <Arduino.h>

+ bool is_led_on = false;

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

// the loop function runs over and over again forever
void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
+  is_led_on = true;
  delay(1000);

  digitalWrite(LED_BUILTIN, LOW);
+  is_led_on = false;
  delay(1000);
}
```
Now we're ready to import and configure DLFLib to handle logging this LED for us!

### DLFLib Setup
```diff lang="c++"
#include <Arduino.h>
+#include <dlf.h>
+#include <FS.h>
+
+Logger myLogger(FS)

bool is_led_on = false;

+myLogger.watch(is_led_on, "is_led_on");

void setup() {
+    myLogger.init()
    pinMode(LED_BUILTIN, OUTPUT);
}

...
```
This create