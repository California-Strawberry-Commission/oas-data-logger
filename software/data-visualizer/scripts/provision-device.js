const { SerialPort } = require("serialport");
const { ReadlineParser } = require("@serialport/parser-readline");
const axios = require("axios");
const nodeCrypto = require("crypto");
const dotenv = require("dotenv");

/**
 * Device Provisioning Script (Host Side)
 * * PURPOSE:
 * Automates the secure pairing of a physical device (ESP32) with the backend server.
 * This script acts as the trusted bridge during the manufacturing/setup phase.
 * * WORKFLOW:
 * 1. LISTEN: Connects to the device via Serial (USB) and waits for it to broadcast its 'DEVICE_ID'.
 * 2. GENERATE: Creates a cryptographically strong 16-byte random secret (32-char Hex).
 * 3. REGISTER (Server): Sends { deviceId, secret } to the local Next.js API.
 * - The Server encrypts this secret (AES-256) and stores it in the DB.
 * 4. FLASH (Device): Sends 'PROV_SET:<secret>' to the device over Serial.
 * - The Device saves this secret to NVS (Non-Volatile Storage).
 * 5. VERIFY: Waits for 'PROV_SUCCESS' confirmation from the device.
 * * USAGE:
 * node scripts/provision-device.js <PORT_PATH>
 * Example: node scripts/provision-device.js /dev/ttyUSB0
 */

dotenv.config({ path: ".env.local" });

const BAUD_RATE = 115200;
const TARGET_API_URL = "https://oas-data-logger.vercel.app/api/admin/provision";

function generateSecret() {
  return nodeCrypto.randomBytes(16).toString("hex");
}

async function main() {
  const args = process.argv.slice(2);
  const portPath = args[0];

  if (!portPath) {
    console.error("Error: Please specify the serial port.");
    console.error("Usage: node scripts/provision-device.js <PORT_PATH>");
    process.exit(1);
  }

  console.log(`Connecting to device on ${portPath}...`);

  const port = new SerialPort({
    path: portPath,
    baudRate: BAUD_RATE,
    autoOpen: false,
  });

  const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

  try {
    await new Promise((resolve, reject) => {
      port.open((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } catch (err) {
    console.error("Failed to open serial port:", err);
    console.error("Make sure the device is plugged in!");
    process.exit(1);
  }

  console.log("Port open. Listening for boot message...");

  let deviceId = null;
  let secret = null;
  let provisioningComplete = false;

  parser.on("data", async (line) => {
    if (line.startsWith("DEVICE_ID:") && !deviceId) {
      deviceId = line.split(":")[1].trim();
      console.log(`\nDetected Device ID: ${deviceId}`);

      secret = generateSecret();
      console.log(`Generated Secret: ${secret}`);

      console.log(`Registering with API (${TARGET_API_URL})...`);

      try {
        await axios.post(TARGET_API_URL, {
          deviceId: deviceId,
          secret: secret,
        });
        console.log("API Registration Successful.");

        console.log("Pushing secret to device NVS...");
        setTimeout(() => {
          port.write(`PROV_SET:${secret}\n`, (err) => {
            if (err) console.error("Error writing to port:", err);
          });
        }, 500);
      } catch (error) {
        console.error("API Registration Failed.");
        if (error.response) {
          console.error(`Status: ${error.response.status}`);
          console.error(`Data: ${JSON.stringify(error.response.data)}`);
        } else {
          console.error(`Error: ${error.message}`);
        }
        console.log("Aborting provisioning process.");
        port.close();
        process.exit(1);
      }
    }

    if (line.includes("PROV_SUCCESS")) {
      console.log("SUCCESS: Device accepted the secret.");
      provisioningComplete = true;
      port.close();
      process.exit(0);
    }

    if (line.includes("PROV_FAIL")) {
      console.error("FAILURE: Device rejected the secret.");
      port.close();
      process.exit(1);
    }
  });

  setTimeout(() => {
    if (!provisioningComplete) {
      console.error(
        "\n Timeout: Device did not respond within the time limit."
      );
      console.error(
        "   (Try unplugging and replugging the device right before running the script)"
      );
      port.close();
      process.exit(1);
    }
  }, 20000);
}

main();
