import "./style.css";

import * as THREE from "https://esm.sh/three";

const vertexShader = `
varying vec2 vUv;

void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fluidFragmentShader = `
uniform sampler2D uPrevTrails;
uniform vec2 uMouse;
uniform vec2 uPrevMouse;
uniform vec2 uResolution;
uniform float uDecay;
uniform bool uIsMoving;
uniform vec2 uClickPosition;
uniform float uClickRadius;
uniform bool uIsClicked;

varying vec2 vUv;

void main() {
    vec4 prevState = texture2D(uPrevTrails, vUv);
    float newValue = prevState.r * uDecay;

    // Mouse trail effect
    if (uIsMoving) {
        vec2 mouseDirection = uMouse - uPrevMouse;
        float lineLength = length(mouseDirection);

        if (lineLength > 0.001) {
            vec2 mouseDir = mouseDirection / lineLength;

            vec2 toPixel = vUv - uPrevMouse;
            float projAlong = dot(toPixel, mouseDir);
            projAlong = clamp(projAlong, 0.0, lineLength);

            vec2 closestPoint = uPrevMouse + projAlong * mouseDir;
            float dist = length(vUv - closestPoint);

            float lineWidth = 0.09;
            float intensity = smoothstep(lineWidth, 0.0, dist) * 0.3;

            newValue += intensity;
        }
    }

    // Click expanding circle effect
    if (uIsClicked) {
        float distToClick = length(vUv - uClickPosition);
        float intensity = step(distToClick, uClickRadius);
        newValue = max(newValue, intensity);
    }

    gl_FragColor = vec4(newValue, 0.0, 0.0, 1.0);
}
`;

const displayFragmentShader = `
uniform sampler2D uFluid;
uniform sampler2D uTopTexture;
uniform sampler2D uBottomTexture;
uniform vec2 uResolution;
uniform float uDpr;
uniform vec2 uTopTextureSize;
uniform vec2 uBottomTextureSize;

varying vec2 vUv;

vec2 getContainUV(vec2 uv, vec2 textureSize) {
    if (textureSize.x < 1.0 || textureSize.y < 1.0) return uv;
    vec2 s = uResolution / textureSize;
    float scale = min(s.x, s.y);
    vec2 scaledSize = textureSize * scale;
    vec2 offset = (uResolution - scaledSize) * 0.5;
    return (uv * uResolution - offset) / scaledSize;
}

void main() {
    float fluid = texture2D(uFluid, vUv).r;
    vec2 topUV = getContainUV(vUv, uTopTextureSize);
    vec2 bottomUV = getContainUV(vUv, uBottomTextureSize);
    vec4 topColor = texture2D(uTopTexture, topUV);
    vec4 bottomColor = texture2D(uBottomTexture, bottomUV);
    float threshold = 0.02;
    float edgeWidth = 0.004 / uDpr;
    float t = smoothstep(threshold, threshold + edgeWidth, fluid);
    vec4 finalColor = mix(topColor, bottomColor, t);
    gl_FragColor = finalColor;
}
`;

window.addEventListener("load", init);

function init() {
  const canvas = document.querySelector("canvas");
  const aspect = 450 / 560;
  const height = window.innerHeight;
  const width = height * aspect;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    precision: "highp",
  });

  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const mouse = new THREE.Vector2(0.5, 0.5);
  const prevMouse = new THREE.Vector2(0.5, 0.5);
  let isMoving = false;
  let lastMoveTime = 0;

  // Click animation variables
  const clickPosition = new THREE.Vector2(0.5, 0.5);
  let isClicked = false;
  let isMouseDown = false;
  let clickStartTime = 0;
  let releaseTime = 0;
  const expansionDuration = 15000; // 15 seconds to complete the expansion
  const contractionDuration = 7500; // 7.5 seconds to contract back
  const maxRadius = 1.5; // Maximum radius to cover entire screen

  const size = 500;
  const pingPongTargets = [
    new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
    }),
    new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
    }),
  ];
  let currentTarget = 0;

  const topTexture = createPlaceholderTexture("#0000ff");
  const bottomTexture = createPlaceholderTexture("#ff0000");

  const topTextureSize = new THREE.Vector2(1, 1);
  const bottomTextureSize = new THREE.Vector2(1, 1);

  const trailsMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uPrevTrails: { value: null },
      uMouse: { value: mouse },
      uPrevMouse: { value: prevMouse },
      uResolution: { value: new THREE.Vector2(size, size) },
      uDecay: { value: 0.97 },
      uIsMoving: { value: false },
      uClickPosition: { value: new THREE.Vector2(0.5, 0.5) },
      uClickRadius: { value: 0.0 },
      uIsClicked: { value: false },
    },
    vertexShader,
    fragmentShader: fluidFragmentShader,
  });

  const displayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uFluid: { value: null },
      uTopTexture: { value: topTexture },
      uBottomTexture: { value: bottomTexture },
      uResolution: {
        value: new THREE.Vector2(width, height),
      },
      uDpr: { value: window.devicePixelRatio },
      uTopTextureSize: { value: topTextureSize },
      uBottomTextureSize: { value: bottomTextureSize },
    },
    vertexShader,
    fragmentShader: displayFragmentShader,
  });

  const img1 = "./IMG_2.jpg";
  const img2 = "./IMG_1-top.jpg";

  loadImage(img1, bottomTexture, bottomTextureSize);
  loadImage(img2, topTexture, topTextureSize);

  const PlaneGeometry = new THREE.PlaneGeometry(2, 2);
  const displayMesh = new THREE.Mesh(PlaneGeometry, displayMaterial);
  scene.add(displayMesh);

  const simMesh = new THREE.Mesh(PlaneGeometry, trailsMaterial);
  const simScene = new THREE.Scene();
  simScene.add(simMesh);

  renderer.setRenderTarget(pingPongTargets[0]);
  renderer.clear();
  renderer.setRenderTarget(pingPongTargets[1]);
  renderer.clear();
  renderer.setRenderTarget(null);

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("touchmove", onTouchMove, { passive: false });
  window.addEventListener("resize", onWindowResize);
  canvas.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  canvas.addEventListener("touchstart", onTouchStart, { passive: false });
  window.addEventListener("touchend", onTouchEnd, { passive: false });

  animate();

  function createPlaceholderTexture(color) {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 512, 512);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    return texture;
  }

  function loadImage(url, targetTexture, textureSizeVector) {
    const img = new Image();
    img.crossOrigin = "Anonymous";

    img.onload = function () {
      const originalWidth = img.width;
      const originalHeight = img.height;
      textureSizeVector.set(originalWidth, originalHeight);
      console.log(
        `Loaded texture: ${url}, size: ${originalWidth}x${originalHeight}`
      );

      const maxSize = 2048;
      let newWidth = originalWidth;
      let newHeight = originalHeight;

      if (originalWidth > maxSize || originalHeight > maxSize) {
        console.log(`Image exceeds max texture size, resizing...`);
        if (originalWidth > originalHeight) {
          newWidth = maxSize;
          newHeight = Math.floor(originalHeight * (maxSize / originalWidth));
        } else {
          newHeight = maxSize;
          newWidth = Math.floor(originalWidth * (maxSize / originalHeight));
        }
      }

      const canvas = document.createElement("canvas");
      canvas.width = newWidth;
      canvas.height = newHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, newWidth, newHeight);

      const newTexture = new THREE.CanvasTexture(canvas);
      newTexture.minFilter = THREE.LinearFilter;
      newTexture.magFilter = THREE.LinearFilter;

      if (url.includes("top")) {
        displayMaterial.uniforms.uTopTexture.value = newTexture;
      } else {
        displayMaterial.uniforms.uBottomTexture.value = newTexture;
      }
    };

    img.onerror = function (err) {
      console.error(`Error loading image ${url}:`, err);
    };

    img.src = url;
  }

  function onMouseMove(event) {
    const canvasRect = canvas.getBoundingClientRect();

    if (
      event.clientX >= canvasRect.left &&
      event.clientX <= canvasRect.right &&
      event.clientY >= canvasRect.top &&
      event.clientY <= canvasRect.bottom
    ) {
      prevMouse.copy(mouse);

      mouse.x = (event.clientX - canvasRect.left) / canvasRect.width;
      mouse.y = 1 - (event.clientY - canvasRect.top) / canvasRect.height;

      isMoving = true;
      lastMoveTime = performance.now();
    } else {
      isMoving = false;
    }
  }

  function onTouchMove(event) {
    if (event.touches.length > 0) {
      event.preventDefault();

      const canvasRect = canvas.getBoundingClientRect();
      const touchX = event.touches[0].clientX;
      const touchY = event.touches[0].clientY;

      if (
        touchX >= canvasRect.left &&
        touchX <= canvasRect.right &&
        touchY >= canvasRect.top &&
        touchY <= canvasRect.bottom
      ) {
        prevMouse.copy(mouse);

        mouse.x = (touchX - canvasRect.left) / canvasRect.width;
        mouse.y = 1 - (touchY - canvasRect.top) / canvasRect.height;

        isMoving = true;
        lastMoveTime = performance.now();
      } else {
        isMoving = false;
      }
    }
  }

  function onWindowResize() {
    const height = window.innerHeight;
    const width = height * aspect;
    renderer.setSize(width, height);

    displayMaterial.uniforms.uResolution.value.set(width, height);
    displayMaterial.uniforms.uDpr.value = window.devicePixelRatio;
  }

  function onMouseDown(event) {
    const canvasRect = canvas.getBoundingClientRect();

    if (
      event.clientX >= canvasRect.left &&
      event.clientX <= canvasRect.right &&
      event.clientY >= canvasRect.top &&
      event.clientY <= canvasRect.bottom
    ) {
      clickPosition.x = (event.clientX - canvasRect.left) / canvasRect.width;
      clickPosition.y =
        1 - (event.clientY - canvasRect.top) / canvasRect.height;

      isClicked = true;
      isMouseDown = true;
      clickStartTime = performance.now();
      releaseTime = 0;
    }
  }

  function onMouseUp(event) {
    if (isMouseDown) {
      isMouseDown = false;
      releaseTime = performance.now();
    }
  }

  function onTouchStart(event) {
    if (event.touches.length > 0) {
      event.preventDefault();

      const canvasRect = canvas.getBoundingClientRect();
      const touchX = event.touches[0].clientX;
      const touchY = event.touches[0].clientY;

      if (
        touchX >= canvasRect.left &&
        touchX <= canvasRect.right &&
        touchY >= canvasRect.top &&
        touchY <= canvasRect.bottom
      ) {
        clickPosition.x = (touchX - canvasRect.left) / canvasRect.width;
        clickPosition.y = 1 - (touchY - canvasRect.top) / canvasRect.height;

        isClicked = true;
        isMouseDown = true;
        clickStartTime = performance.now();
        releaseTime = 0;
      }
    }
  }

  function onTouchEnd(event) {
    if (isMouseDown) {
      isMouseDown = false;
      releaseTime = performance.now();
    }
  }

  function animate() {
    requestAnimationFrame(animate);

    if (isMoving && performance.now() - lastMoveTime > 50) {
      isMoving = false;
    }

    // Handle click animation
    let currentRadius = 0.0;
    if (isClicked) {
      if (isMouseDown) {
        // Expansion phase - while mouse/touch is held down
        const elapsed = performance.now() - clickStartTime;
        const progress = Math.min(elapsed / expansionDuration, 1.0);

        // Ease-out function for smooth expansion
        const easeOut = 1 - Math.pow(1 - progress, 3);
        currentRadius = easeOut * maxRadius;
      } else if (releaseTime > 0) {
        // Contraction phase - after mouse/touch is released
        const elapsedSinceRelease = performance.now() - releaseTime;
        const contractionProgress = Math.min(
          elapsedSinceRelease / contractionDuration,
          1.0
        );

        // Get the radius at the moment of release
        const releaseElapsed = releaseTime - clickStartTime;
        const releaseProgress = Math.min(
          releaseElapsed / expansionDuration,
          1.0
        );
        const releaseEaseOut = 1 - Math.pow(1 - releaseProgress, 3);
        const radiusAtRelease = releaseEaseOut * maxRadius;

        // Ease-in function for smooth contraction
        const easeIn = Math.pow(1 - contractionProgress, 2);
        currentRadius = radiusAtRelease * easeIn;

        // End animation when contraction is complete
        if (contractionProgress >= 1.0) {
          isClicked = false;
          releaseTime = 0;
        }
      }
    }

    const prevTarget = pingPongTargets[currentTarget];
    currentTarget = (currentTarget + 1) % 2;
    const currentRenderTarget = pingPongTargets[currentTarget];

    trailsMaterial.uniforms.uPrevTrails.value = prevTarget.texture;
    trailsMaterial.uniforms.uMouse.value.copy(mouse);
    trailsMaterial.uniforms.uPrevMouse.value.copy(prevMouse);
    trailsMaterial.uniforms.uIsMoving.value = isMoving;
    trailsMaterial.uniforms.uClickPosition.value.copy(clickPosition);
    trailsMaterial.uniforms.uClickRadius.value = currentRadius;
    trailsMaterial.uniforms.uIsClicked.value = isClicked;

    renderer.setRenderTarget(currentRenderTarget);
    renderer.render(simScene, camera);

    displayMaterial.uniforms.uFluid.value = currentRenderTarget.texture;

    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }
}
