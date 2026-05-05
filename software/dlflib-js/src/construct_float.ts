import { write as floatWrite } from 'ieee754';
import { Endian } from "construct-js";

/*
  This file was created with code from https://github.com/francisrstokes/construct-js/issues/37

  Construct-js does not support floats/doubles as primitives natively. Therefore, we use this class
  to accomplish the goal of supporting floats/doubles.
*/

export class FloatField {
  public width: number;
  public min: number;
  public max: number;
  public toBytesFn: (vals: number[], isLE: boolean) => Uint8Array;
  public value: number;
  public endian: Endian;

  constructor(width: number, min: number, max: number, toBytesFn: (vals: number[], isLE: boolean) => Uint8Array, value: number, endian: Endian) {
      this.width = width;
      this.min = min;
      this.max = max;
      this.toBytesFn = toBytesFn;
      this.value = value;
      this.endian = endian;
  }
  computeBufferSize() { return this.width; }
  toUint8Array() {
      return this.toBytesFn([this.value], this.endian === Endian.Little);
  }
  set(value: number) {
      this.value = value;
  }
  get() { return this.value; }
}

// 32-bit Float
const IEEE754_FLOAT32_MAX = (2 - (2 ** -23)) * (2 ** 127);
const IEEE754_FLOAT32_MIN = IEEE754_FLOAT32_MAX * -1;
const f32Tou8s = (vals: number[], isLittleEndian: boolean) => {
  const stride = 4;
  const buff = new Uint8Array(vals.length * stride);
  for (let [i, val] of vals.entries()) {
    floatWrite(buff, val, i * stride, isLittleEndian, 23, 4);
  }
  return buff;
}
export const F32 = (value: number, endian: Endian = Endian.Little) => new FloatField(4, IEEE754_FLOAT32_MIN, IEEE754_FLOAT32_MAX, f32Tou8s, value, endian);

// 64-bit Double
const f64Tou8s = (vals: number[], isLittleEndian: boolean) => {
  const stride = 8;
  const buff = new Uint8Array(vals.length * stride);
  for (let [i, val] of vals.entries()) {
    floatWrite(buff, val, i * stride, isLittleEndian, 52, 8);
  }
  return buff;
}
export const F64 = (value: number, endian: Endian = Endian.Little) => new FloatField(8, -Number.MAX_VALUE, Number.MAX_VALUE, f64Tou8s, value, endian);
