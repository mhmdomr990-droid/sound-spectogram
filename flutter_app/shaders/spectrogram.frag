#version 460 core

#include <flutter/runtime_effect.glsl>

uniform sampler2D u_intensity;
uniform sampler2D u_palette;
uniform vec2 u_resolution;

out vec4 fragColor;

void main() {
    vec2 uv = FlutterFragCoord().xy / u_resolution;

    float intensity = texture(u_intensity, uv).r;

    fragColor = texture(u_palette, vec2(intensity, 0.5));
}
