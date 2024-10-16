<script lang="ts">
  import { struct, uint8 } from "lightstruct";
  import { HTTPAdapter } from "./dlflib-js/dlflib";

  const typeParsers = {
    "constexpr const char* t() [with T = polled_data1]": struct({
      i1: uint8,
      i2: uint8,
      i3: uint8,
      i4: uint8,
      i5: uint8,
    }),
    "constexpr const char* t() [with T = polled_data2]": struct({
      i1: uint8,
      i2: uint8,
      i3: uint8,
      i4: uint8,
      i5: uint8,
      i6: uint8,
    }),
    "constexpr const char* t() [with T = unsigned char]": uint8,
  };

  let a = new HTTPAdapter(typeParsers, "/runs/ex_basic");
</script>

<main>HISDA</main>

{#await a.events_data() then e}
  <pre>
    {JSON.stringify(e, null, 2)}
  </pre>
{/await}
