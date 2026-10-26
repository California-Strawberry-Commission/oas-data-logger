## Extracting logs from device

With the device connected to the host machine, run the custom VS Code PlatformIO project task under `Custom` -> `Download Filesystem`.

Alternatively, it can be run via 'pio run -t downloadfs' from the commandline.

## Updating CA certs

Update root CA cert for oas-data-logger.vercel.app:

```
openssl s_client -connect oas-data-logger.vercel.app:443 -showcerts 2>/dev/null </dev/null | \
  awk 'BEGIN{p=0} /BEGIN CERTIFICATE/{p=1; cert=$0; next} p{cert=cert"\n"$0} /END CERTIFICATE/{last=cert; p=0} END{print last}' \
  > oas-logger/src/certs/vercel_root_ca.pem
```

Update root CA cert for S3:

```
openssl s_client -connect s3.amazonaws.com:443 -showcerts 2>/dev/null </dev/null | \
  awk 'BEGIN{p=0} /BEGIN CERTIFICATE/{p=1; cert=$0; next} p{cert=cert"\n"$0} /END CERTIFICATE/{last=cert; p=0} END{print last}' \
  > oas-logger/src/certs/s3_root_ca.pem
```

## Releasing firmware

Firmware releases (building at a git ref, creating the GitHub release, and pushing OTA updates to devices) are done via the `release-firmware` script in data-visualizer. See [Pushing OTA firmware](../data-visualizer/README.md#pushing-ota-firmware) in the data-visualizer README.
