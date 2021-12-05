//--------------------------------------------------------------------------------
// conversion functions
//--------------------------------------------------------------------------------

const PI = Math.PI;
const cos = Math.cos;
const sin = Math.sin;
const asin = Math.asin;
const atan2 = Math.atan2;

// degrees (0-360) -> radiants (0-2PI)
function degToRad(deg) {
  return (deg * PI) / 180;
}

// radiants (0-2PI) -> degrees (0-360)
function radToDeg(rad) {
  return (rad * 180) / PI;
}

// [deg, mins, secs] -> degrees
function dmsToDeg([degs, mins, secs]) {
  return degs + mins / 60 + secs / 3600;
}

// [hours, mins, secs] -> degrees
function hmsToDeg([hours, mins, secs]) {
  return ((hours + mins / 60 + secs / 3600) / 24) * 360;
}

// ra/dec (degrees) -> [x, y, z] (j2000)
function degToJ2000(raDeg, decDeg) {
  let α = degToRad(raDeg);
  let δ = degToRad(decDeg);
  return [cos(δ) * cos(α), cos(δ) * sin(α), sin(δ)];
}

// [x, y, z] (j2000) -> ra/dec (degrees)
function j2000ToDeg([x, y, z]) {
  return [normalizeDeg(radToDeg(atan2(y, x))), normalizeDeg(radToDeg(asin(z)))];
}

function normalizeDeg(deg) {
  deg = deg % 360;
  if (deg < 0) deg += 360;
  return deg;
}

module.exports = {
  degToRad,
  radToDeg,
  dmsToDeg,
  hmsToDeg,
  degToJ2000,
  j2000ToDeg,
  normalizeDeg,
};
