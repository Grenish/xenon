"use client";

import { useEffect, useRef } from "react";
import { createShaderProgram } from "./shader-program";

// Each instance sweeps a strip around the ring. Changing the tube radius along
// its orbit gives it a narrow waist and a broad face for the engraved lines.
const vertex = `#version 300 es
precision highp float;
uniform vec2 size;
uniform float time;
uniform vec2 pointerTilt;
out vec2 surface;
out vec3 normal;
const float tau = 6.2831853;

void main() {
  surface = vec2(float(gl_VertexID / 2) / 144.0,
                 float(gl_InstanceID + gl_VertexID % 2) / 48.0);
  float u = tau * surface.x;
  float v = tau * surface.y;
  float phase = u - time * 0.15;
  float tube = 0.23 + 0.075 * cos(2.0 * phase + 0.6);
  float radius = 0.69 + tube * cos(v);
  vec2 radial = vec2(cos(u), sin(u));
  vec3 p = vec3(radius * radial, tube * sin(v) + 0.13 * sin(2.0 * phase));
  vec3 along = vec3(radius * vec2(-radial.y, radial.x), 0.26 * cos(2.0 * phase))
    - 0.15 * sin(2.0 * phase + 0.6) * vec3(cos(v) * radial, sin(v));
  vec3 around = vec3(-sin(v) * radial, cos(v));
  vec3 n = normalize(cross(along, around));

  float tilt = 0.99 + 0.12 * sin(time * 0.13) + 0.09 * pointerTilt.y;
  mat2 pitch = mat2(cos(tilt), sin(tilt), -sin(tilt), cos(tilt));
  float roll = 0.62 + 0.06 * sin(time * 0.1) + 0.065 * pointerTilt.x;
  mat2 slant = mat2(cos(roll), sin(roll), -sin(roll), cos(roll));
  p.yz = pitch * p.yz;
  p.xy = slant * p.xy;
  n.yz = pitch * n.yz;
  n.xy = slant * n.xy;
  normal = n;
  float landscape = smoothstep(0.8, 1.5, size.x / size.y);
  float scale = mix(min(size.x * 2.20, size.y * 1.65),
                    min(size.x * 1.18, size.y * 2.65), landscape);
  vec2 center = mix(vec2(0.55, -0.02), vec2(0.60, -0.18), landscape);
  gl_Position = vec4(center + p.xy * scale / size, -0.5 * p.z, 1.0);
}`;

const fragment = `#version 300 es
precision highp float;
uniform vec2 size;
in vec2 surface;
in vec3 normal;
out vec4 color;

// Filter the rulings where they converge into a silhouette.
float engraving(float coordinate) {
  float width = max(fwidth(coordinate), 0.001);
  float d = abs(fract(coordinate + 0.5) - 0.5);
  return (1.0 - smoothstep(0.0, width * 1.05, d)) / max(1.0, width * 2.1);
}

void main() {
  vec3 n = normalize(normal);
  float light = clamp(dot(n, normalize(vec3(-0.45, 0.72, 0.55))), 0.0, 1.0);
  float rim = pow(1.0 - max(n.z, 0.0), 2.0);
  float flute = surface.x * 128.0 + surface.y * 5.0;
  float lines = engraving(flute);
  float bands = engraving(surface.y * 8.0);
  // Print the contours directly on the section's paper. Let the ink thin
  // toward the headline on the left and the installation copy at the foot.
  vec2 page = gl_FragCoord.xy / size;
  float margin = smoothstep(0.06, 0.86, page.x + 0.33 * (1.0 - page.y));
  float foot = smoothstep(-0.04, 0.28, page.y);
  float pressure = (0.14 + 0.86 * margin) * mix(0.22, 1.0, foot);
  float middle = smoothstep(0.22, 0.43, page.y) * (1.0 - smoothstep(0.62, 0.82, page.y));
  pressure *= mix(0.24 + 0.76 * middle, 1.0, smoothstep(0.8, 1.5, size.x / size.y));
  float ink = pressure * (0.065 * (1.0 - light) + 0.08 * rim + 0.70 * lines + 0.12 * bands);
  vec3 teal = vec3(27.0, 108.0, 128.0) / 255.0;
  color = vec4(teal * ink, ink);
}`;

export function OrbitalField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const section = canvas?.parentElement;
    if (!canvas || !section) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let gl: WebGL2RenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let time: WebGLUniformLocation | null = null;
    let size: WebGLUniformLocation | null = null;
    let pointerTilt: WebGLUniformLocation | null = null;
    let tiltX = 0, tiltY = 0;
    let pointerMoved = false;
    let returning = false;
    let visible = false;
    let frame = 0;
    let previous = 0;
    let elapsed = 0;

    function initialize() {
      gl = canvas!.getContext("webgl2", { powerPreference: "low-power", antialias: true });
      if (!gl) return;
      program = createShaderProgram(gl, vertex, fragment);
      if (!program) return;
      gl.useProgram(program);
      gl.enable(gl.DEPTH_TEST);
      time = gl.getUniformLocation(program, "time");
      size = gl.getUniformLocation(program, "size");
      pointerTilt = gl.getUniformLocation(program, "pointerTilt");
    }

    function track(event: PointerEvent) {
      if (!visible || motion.matches || !event.isPrimary) return;
      const rect = section!.getBoundingClientRect();
      const touch = event.pointerType === "touch";
      tiltX = 2 * (event.clientX - rect.left) / rect.width - 1;
      tiltY = 1 - 2 * (event.clientY - rect.top) / rect.height;
      if (touch) tiltY = 0.3 + 0.7 * tiltY;
      pointerMoved = true;
      returning = false;
    }

    function release(event: PointerEvent) {
      if (!event.isPrimary || (event.type === "pointerup" && event.pointerType !== "touch")) return;
      returning = tiltX !== 0 || tiltY !== 0;
    }

    function draw(now: number) {
      frame = 0;
      if (!gl || !program) return;
      // Track input on the next display frame. Only the ambient orbit is capped.
      if (pointerMoved || returning || !previous || now - previous >= 1000 / 30 - 0.5) {
        const dt = previous ? Math.min(now - previous, 100) / 1000 : 0;
        elapsed += dt;
        previous = now;
        if (returning && !pointerMoved) {
          const decay = Math.exp(-12 * dt);
          tiltX *= decay;
          tiltY *= decay;
          if (Math.max(Math.abs(tiltX), Math.abs(tiltY)) < 0.001) {
            returning = false;
            tiltX = tiltY = 0;
          }
        }
        pointerMoved = false;
        gl.uniform2f(pointerTilt, tiltX, tiltY);
        gl.uniform1f(time, motion.matches ? 0 : elapsed);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 290, 48);
      }
      if (!motion.matches) frame = requestAnimationFrame(draw);
    }

    function refresh() {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!visible || document.hidden || motion.matches) {
        tiltX = tiltY = 0;
        pointerMoved = returning = false;
      }
      if (!visible || document.hidden) return;
      if (!gl) initialize();
      if (!gl || !program) return;
      const { width, height } = canvas!.getBoundingClientRect();
      if (!width || !height) return;
      const dpr = Math.min(devicePixelRatio, 1.5, 1440 / Math.max(width, height));
      const w = Math.max(1, Math.round(width * dpr));
      const h = Math.max(1, Math.round(height * dpr));
      if (canvas!.width !== w) canvas!.width = w;
      if (canvas!.height !== h) canvas!.height = h;
      gl.viewport(0, 0, w, h);
      gl.uniform2f(size, w, h);
      frame = requestAnimationFrame(draw);
    }

    function lost(event: Event) {
      event.preventDefault();
      cancelAnimationFrame(frame);
      program = null;
    }
    function restore() {
      gl = null;
      refresh();
    }
    const viewport = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      refresh();
    });
    const resize = new ResizeObserver(refresh);
    viewport.observe(canvas);
    resize.observe(canvas);
    const pointers = new AbortController();
    const options = { passive: true, signal: pointers.signal };
    section.addEventListener("pointermove", track, options);
    section.addEventListener("pointerdown", track, options);
    section.addEventListener("pointerup", release, options);
    section.addEventListener("pointerleave", release, options);
    section.addEventListener("pointercancel", release, options);
    document.addEventListener("visibilitychange", refresh);
    motion.addEventListener("change", refresh);
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restore);
    return () => {
      pointers.abort();
      cancelAnimationFrame(frame);
      viewport.disconnect();
      resize.disconnect();
      document.removeEventListener("visibilitychange", refresh);
      motion.removeEventListener("change", refresh);
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restore);
      gl?.deleteProgram(program);
    };
  }, []);

  return (
    <canvas ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 size-full" />
  );
}
