const astrbotApi = "https://api.github.com/repos/AstrbotDevs/AstrBot/contributors?per_page=1000";
const pluginsApi = "https://api.soulter.top/astrbot/plugins";

const astrbotGrid = document.getElementById("astrbot-grid");
const pluginsGrid = document.getElementById("plugins-grid");
const astrbotMeta = document.getElementById("astrbot-meta");
const pluginsMeta = document.getElementById("plugins-meta");
const tooltip = document.getElementById("star-tooltip");
const hud = document.getElementById("flight-hud");
const hudSpeed = document.getElementById("hud-speed");
const hudAccel = document.getElementById("hud-accel");

const toggleConstellationBtn = document.getElementById("toggle-constellation");
const toggleLangBtn = document.getElementById("toggle-lang");

let constellationMode = false;
let renderer, scene, camera, stars, nebula, clock;
let targetRotation = { x: 0, y: 0 };
let astrbotContributors = [];
let pluginContributors = [];
let pluginRepoCount = 0;
let constellationGroup = null;
let constellationNodes = [];
let avatarLoader = null;
let raycaster = null;
let pointer = null;
let isDragging = false;
let lastPointer = { x: 0, y: 0 };
let cameraYaw = 0;
let cameraPitch = 0;
let keysPressed = new Set();
let velocity = new THREE.Vector3(0, 0, 0);
let accelVector = new THREE.Vector3(0, 0, 0);
let orbitTime = 0;
let currentLang = "zh";

const translations = {
  zh: {
    heroBadge: "ASTRBOT / CONTRIBUTORS",
    heroTitle: "贡献者宇宙",
    toggleConstellation: "星图模式",
    toggleConstellationExit: "退出星图模式",
    toggleLang: "English",
    astrbotTitle: "AstrBot 贡献者",
    astrbotDesc: "核心仓库：AstrbotDevs/AstrBot",
    pluginsTitle: "插件贡献者",
    pluginsDesc: "从插件仓库聚合贡献者星图",
    footer: "Powered by 3D 星图引擎 • 交互提示：移动鼠标 / 拖动 / 滚动缩放",
    hudTitle: "飞行",
    hudSpeed: "速度",
    hudAccel: "加速度",
    loading: "加载中…",
    waiting: "等待星云展开…",
    loadFail: "加载失败，请稍后重试",
    pluginLoadFail: "插件星云加载失败",
    pluginNoRepo: "未找到插件仓库信息",
    scanningRepos: "正在扫描 {count} 个插件仓库…",
    aggregated: "聚合 {contributors} 位贡献者 · {repos} 个仓库",
    loadedContributors: "已载入 {count} 位贡献者",
    stellarContributor: "星际贡献者",
    developer: "开发者",
    contribLabel: "贡献",
  },
  en: {
    heroBadge: "ASTRBOT / CONTRIBUTORS",
    heroTitle: "Contributor Cosmos",
    toggleConstellation: "Constellation",
    toggleConstellationExit: "Exit Constellation",
    toggleLang: "中文",
    astrbotTitle: "AstrBot Contributors",
    astrbotDesc: "Core repo: AstrbotDevs/AstrBot",
    pluginsTitle: "Plugin Contributors",
    pluginsDesc: "Aggregate contributors from plugin repos",
    footer: "Powered by 3D star map • Tips: move / drag / scroll",
    hudTitle: "Flight",
    hudSpeed: "Speed",
    hudAccel: "Accel",
    loading: "Loading…",
    waiting: "Waiting for the nebula…",
    loadFail: "Failed to load. Please retry.",
    pluginLoadFail: "Failed to load plugin nebula",
    pluginNoRepo: "No plugin repo info found",
    scanningRepos: "Scanning {count} plugin repos…",
    aggregated: "{contributors} contributors · {repos} repos",
    loadedContributors: "Loaded {count} contributors",
    stellarContributor: "Stellar contributor",
    developer: "Developer",
    contribLabel: "Contrib",
  },
};

function formatNumber(value) {
  const locale = currentLang === "zh" ? "zh-CN" : "en-US";
  return new Intl.NumberFormat(locale).format(value || 0);
}

function t(key, vars = {}) {
  const bundle = translations[currentLang] || translations.zh;
  let text = bundle[key] || key;
  Object.entries(vars).forEach(([k, v]) => {
    text = text.replaceAll(`{${k}}`, v);
  });
  return text;
}

function updateStaticText() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    el.textContent = t(key);
  });
  toggleConstellationBtn.textContent = constellationMode
    ? t("toggleConstellationExit")
    : t("toggleConstellation");
  toggleLangBtn.textContent = t("toggleLang");
}

function createCard(contributor, index = 0) {
  const card = document.createElement("article");
  card.className = "card";
  card.style.transform = `translateZ(${index % 2 === 0 ? "0" : "0"})`;

  const top = document.createElement("div");
  top.className = "card__top";

  const img = document.createElement("img");
  img.src = contributor.avatar_url || contributor.avatar || "";
  img.alt = contributor.login || contributor.name || "Contributor";

  const info = document.createElement("div");
  const title = document.createElement("h3");
  title.textContent = contributor.login || contributor.name || "未知";
  const subtitle = document.createElement("span");
  subtitle.textContent = contributor.repo ? contributor.repo : t("stellarContributor");

  info.appendChild(title);
  info.appendChild(subtitle);

  top.appendChild(img);
  top.appendChild(info);

  const meta = document.createElement("div");
  meta.className = "card__meta";
  meta.innerHTML = `<div>${contributor.type || t("developer")}</div>`;

  card.appendChild(top);
  card.appendChild(meta);

  if (contributor.html_url) {
    card.addEventListener("click", () => {
      window.open(contributor.html_url, "_blank");
    });
    card.style.cursor = "pointer";
  }

  return card;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} (${response.status})`);
  }
  return response.json();
}

async function loadAstrBotContributors() {
  try {
    const data = await fetchJson(astrbotApi);
    astrbotContributors = data;
    astrbotGrid.innerHTML = "";
    data.forEach((contributor, index) => {
      astrbotGrid.appendChild(createCard(contributor, index));
    });
    astrbotMeta.textContent = t("loadedContributors", {
      count: formatNumber(data.length),
    });
    refreshConstellation();
  } catch (error) {
    astrbotMeta.textContent = t("loadFail");
    console.error(error);
  }
}

function parseRepoInfo(plugin) {
  const repoField = plugin.repo || plugin.repository || plugin.github || plugin.url || "";
  if (!repoField) return null;

  if (repoField.includes("github.com")) {
    const match = repoField.match(/github.com\/([\w.-]+)\/([\w.-]+)/i);
    if (match) {
      return { owner: match[1], name: match[2] };
    }
  }

  const parts = repoField.split("/");
  if (parts.length === 2) {
    return { owner: parts[0], name: parts[1] };
  }

  return null;
}

async function loadPluginContributors() {
  try {
    const localPath = "plugins-contributors.json";
    let data = null;
    try {
      data = await fetchJson(localPath);
    } catch (error) {
      data = null;
    }

    if (data && Array.isArray(data.contributors)) {
      pluginContributors = data.contributors;
      pluginRepoCount = data.repo_count || 0;
      pluginsGrid.innerHTML = "";
      data.contributors.forEach((contributor, order) => {
        pluginsGrid.appendChild(createCard(contributor, order));
      });
      pluginsMeta.textContent = t("aggregated", {
        contributors: formatNumber(data.contributor_count),
        repos: formatNumber(data.repo_count),
      });
      refreshConstellation();
      return;
    }

    const plugins = await fetchJson(pluginsApi);
    const pluginList = Array.isArray(plugins) ? plugins : Object.values(plugins || {});
    const repos = pluginList.map(parseRepoInfo).filter(Boolean);

    if (!repos.length) {
      pluginsMeta.textContent = t("pluginNoRepo");
      return;
    }

    pluginsMeta.textContent = t("scanningRepos", { count: formatNumber(repos.length) });

    const contributorsMap = new Map();
    const concurrency = 4;
    let index = 0;

    async function worker() {
      while (index < repos.length) {
        const current = repos[index++];
        const url = `https://api.github.com/repos/${current.owner}/${current.name}/contributors`;
        try {
          const list = await fetchJson(url);
          list.forEach((contributor) => {
            const key = contributor.login || contributor.name;
            if (!key) return;
            const existing = contributorsMap.get(key);
            const merged = {
              ...contributor,
              contributions: (existing?.contributions || 0) + (contributor.contributions || 0),
              repo: existing?.repo || `${current.owner}/${current.name}`,
            };
            contributorsMap.set(key, merged);
          });
        } catch (error) {
          console.warn("插件仓库加载失败", current, error);
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()));

    const contributors = Array.from(contributorsMap.values()).sort(
      (a, b) => (b.contributions || 0) - (a.contributions || 0)
    );
    pluginContributors = contributors;
    pluginRepoCount = repos.length;

    pluginsGrid.innerHTML = "";
    contributors.forEach((contributor, order) => {
      pluginsGrid.appendChild(createCard(contributor, order));
    });

    pluginsMeta.textContent = t("aggregated", {
      contributors: formatNumber(contributors.length),
      repos: formatNumber(repos.length),
    });
    refreshConstellation();
  } catch (error) {
    pluginsMeta.textContent = t("pluginLoadFail");
    console.error(error);
  }
}

function initSpace() {
  const canvas = document.getElementById("space");
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, 2000);
  camera.position.z = 420;

  clock = new THREE.Clock();
  raycaster = new THREE.Raycaster();
  raycaster.params.Points.threshold = 10;
  pointer = new THREE.Vector2();
  avatarLoader = new THREE.TextureLoader();

  const starGeometry = new THREE.BufferGeometry();
  const starCount = 2000;
  const positions = new Float32Array(starCount * 3);
  const colors = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    const radius = 600 * Math.random() + 200;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);

    const x = radius * Math.sin(phi) * Math.cos(theta);
    const y = radius * Math.sin(phi) * Math.sin(theta);
    const z = radius * Math.cos(phi);

    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    const color = new THREE.Color();
    color.setHSL(0.58 + Math.random() * 0.1, 0.8, 0.6 + Math.random() * 0.2);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  starGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const starMaterial = new THREE.PointsMaterial({
    size: 2.2,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  });

  stars = new THREE.Points(starGeometry, starMaterial);
  scene.add(stars);

  const nebulaGeometry = new THREE.SphereGeometry(180, 32, 32);
  const nebulaMaterial = new THREE.MeshBasicMaterial({
    color: 0x5c1fd4,
    wireframe: true,
    transparent: true,
    opacity: 0.18,
  });
  nebula = new THREE.Mesh(nebulaGeometry, nebulaMaterial);
  scene.add(nebula);

  animate();
}

function refreshConstellation() {
  if (!constellationMode || !scene) return;
  buildConstellation();
}

function buildConstellation() {
  if (constellationGroup) {
    scene.remove(constellationGroup);
    constellationGroup.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  constellationGroup = new THREE.Group();
  constellationNodes = [];

  const core = (astrbotContributors || []).slice();
  const plugins = (pluginContributors || []).slice();

  if (!core.length && !plugins.length) return;

  constellationGroup.add(
    createConstellationSprites(core, {
      radius: 160,
      spread: 90,
      hue: 0.57,
      label: "AstrBot",
    })
  );
  constellationGroup.add(
    createConstellationSprites(plugins, {
      radius: 260,
      spread: 130,
      hue: 0.84,
      label: "Plugin",
    })
  );

  scene.add(constellationGroup);
}

function createConstellationSprites(list, options) {
  const { radius, spread, hue, label } = options;
  const count = list.length;
  const group = new THREE.Group();
  const data = [];

  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const maxContrib = Math.max(...list.map((c) => c.contributions || 1), 1);
  const baseTexture = createCircleTexture();

  for (let i = 0; i < count; i++) {
    const contributor = list[i];
    const t = i / Math.max(count - 1, 1);
    const angle = i * goldenAngle;
    const r = radius + t * spread;
    const y = (Math.sin(angle) * 0.5 + Math.cos(angle * 0.7)) * 50;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    const intensity = Math.min((contributor.contributions || 1) / maxContrib, 1);
    const color = new THREE.Color();
    color.setHSL(hue, 0.85, 0.45);
    const size = 10 + intensity * 5;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: baseTexture,
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });

    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.set(x, y, z);
    sprite.scale.set(size, size, 1);
    sprite.userData = {
      name: contributor.login || contributor.name || "未知",
      contributions: contributor.contributions || 0,
      avatar: contributor.avatar_url || contributor.avatar || "",
      type: label,
    };
    group.add(sprite);
    constellationNodes.push(sprite);

    if (sprite.userData.avatar) {
      avatarLoader.load(
        sprite.userData.avatar,
        (texture) => {
          const rounded = createRoundedAvatarTexture(texture.image);
          sprite.material.map = rounded;
          sprite.material.needsUpdate = true;
        },
        undefined,
        () => {}
      );
    }

    data.push({
      name: contributor.login || contributor.name || "未知",
      contributions: contributor.contributions || 0,
      avatar: contributor.avatar_url || contributor.avatar || "",
      type: label,
    });
  }
  group.userData = { data };
  return group;
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  stars.rotation.y += 0.0006;
  stars.rotation.x += 0.00035;
  nebula.rotation.y -= 0.0006;
  nebula.rotation.x += 0.0004;

  if (!constellationMode) {
    scene.rotation.x += (targetRotation.x - scene.rotation.x) * 0.05;
    scene.rotation.y += (targetRotation.y - scene.rotation.y) * 0.05;
  } else {
    updateFreeFly(delta);
    updateOrbiting(delta);
  }

  const pulse = (Math.sin(elapsed * 0.6) + 1) / 2;
  nebula.material.opacity = 0.2 + pulse * 0.15;

  renderer.render(scene, camera);
}

function onResize() {
  if (!camera || !renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onPointerMove(event) {
  if (!constellationMode || !isDragging) {
    const x = (event.clientX / window.innerWidth - 0.5) * 0.6;
    const y = (event.clientY / window.innerHeight - 0.5) * 0.6;
    targetRotation = { x: y, y: x };
  } else {
    const deltaX = event.clientX - lastPointer.x;
    const deltaY = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    cameraYaw -= deltaX * 0.003;
    cameraPitch -= deltaY * 0.003;
    cameraPitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, cameraPitch));
  }

  if (!constellationMode || !renderer || !raycaster || !pointer) {
    hideTooltip();
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(constellationNodes, true);

  if (intersects.length) {
    const hit = intersects[0];
    const data = hit.object.userData;
    showTooltip(event.clientX, event.clientY, data);
  } else {
    hideTooltip();
  }
}

function onWheel(event) {
  if (constellationMode) {
    const delta = Math.sign(event.deltaY);
    const move = delta * 20;
    moveCameraForward(-move);
  } else {
    const delta = Math.sign(event.deltaY);
    camera.position.z = Math.min(700, Math.max(260, camera.position.z + delta * 20));
  }
}

function addInteractions() {
  window.addEventListener("resize", onResize);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("wheel", onWheel, { passive: true });
  window.addEventListener("pointerdown", (event) => {
    if (!constellationMode) return;
    isDragging = true;
    lastPointer = { x: event.clientX, y: event.clientY };
  });
  window.addEventListener("pointerup", () => {
    isDragging = false;
  });
  window.addEventListener("keydown", (event) => {
    keysPressed.add(event.key.toLowerCase());
  });
  window.addEventListener("keyup", (event) => {
    keysPressed.delete(event.key.toLowerCase());
  });

  toggleConstellationBtn.addEventListener("click", () => {
    constellationMode = !constellationMode;
    document.body.classList.toggle("constellation-mode", constellationMode);
    toggleConstellationBtn.textContent = constellationMode
      ? t("toggleConstellationExit")
      : t("toggleConstellation");
    if (constellationMode) {
      cameraYaw = 0;
      cameraPitch = 0;
      velocity.set(0, 0, 0);
      accelVector.set(0, 0, 0);
      hud.classList.add("hud--show");
      buildConstellation();
    } else if (constellationGroup) {
      scene.remove(constellationGroup);
      constellationGroup = null;
      constellationNodes = [];
      hud.classList.remove("hud--show");
      hideTooltip();
    }
  });

}

function showTooltip(x, y, data) {
  if (!data || !tooltip) return;
  tooltip.classList.add("tooltip--show");
  const avatar = data.avatar
    ? `<img src="${data.avatar}" alt="${data.name}" />`
    : "";
  tooltip.innerHTML = `
    <div class="tooltip__row">
      ${avatar}
      <div>
        <strong>${data.name}</strong><br/>
        ${data.type} · ${t("contribLabel")} ${formatNumber(data.contributions)}
      </div>
    </div>
  `;
  const offset = 14;
  const maxX = window.innerWidth - 200;
  const maxY = window.innerHeight - 80;
  tooltip.style.left = `${Math.min(x + offset, maxX)}px`;
  tooltip.style.top = `${Math.min(y + offset, maxY)}px`;
}

function hideTooltip() {
  if (!tooltip) return;
  tooltip.classList.remove("tooltip--show");
}

function createCircleTexture() {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.1,
    size / 2,
    size / 2,
    size / 2
  );
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createRoundedAvatarTexture(image) {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(image, 0, 0, size, size);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function updateFreeFly(delta) {
  const baseAccel = keysPressed.has("shift") ? 5500 : 2200;
  const damping = 0.935;
  const maxSpeed = keysPressed.has("shift") ? 3200 : 1800;
  const forward = keysPressed.has("w") || keysPressed.has("arrowup");
  const backward = keysPressed.has("s") || keysPressed.has("arrowdown");
  const left = keysPressed.has("a") || keysPressed.has("arrowleft");
  const right = keysPressed.has("d") || keysPressed.has("arrowright");
  const up = keysPressed.has("q");
  const down = keysPressed.has("e");

  const direction = new THREE.Vector3();
  if (forward) direction.z -= 1;
  if (backward) direction.z += 1;
  if (left) direction.x -= 1;
  if (right) direction.x += 1;
  if (up) direction.y += 1;
  if (down) direction.y -= 1;

  accelVector.set(0, 0, 0);
  if (direction.lengthSq() > 0) {
    direction.normalize();
    const rotation = new THREE.Euler(cameraPitch, cameraYaw, 0, "YXZ");
    direction.applyEuler(rotation);
    accelVector.copy(direction).multiplyScalar(baseAccel);
  }

  velocity.addScaledVector(accelVector, delta);
  velocity.multiplyScalar(damping);
  if (velocity.length() > maxSpeed) {
    velocity.setLength(maxSpeed);
  }

  camera.position.addScaledVector(velocity, delta);

  camera.rotation.order = "YXZ";
  camera.rotation.y = cameraYaw;
  camera.rotation.x = cameraPitch;

  updateHud();
}

function moveCameraForward(amount) {
  const dir = new THREE.Vector3(0, 0, -1);
  const rotation = new THREE.Euler(cameraPitch, cameraYaw, 0, "YXZ");
  dir.applyEuler(rotation);
  camera.position.add(dir.multiplyScalar(amount));
}

function updateOrbiting(delta) {
  if (!constellationGroup) return;
  orbitTime += delta;
  const orbitSpeed = 0.25;
  constellationNodes.forEach((sprite) => {
    if (!sprite.userData.basePosition) {
      sprite.userData.basePosition = sprite.position.clone();
      sprite.userData.orbitOffset = Math.random() * Math.PI * 2;
      sprite.userData.orbitRadius = 4 + Math.random() * 8;
    }
    const angle = orbitTime * orbitSpeed + sprite.userData.orbitOffset;
    const orbitRadius = sprite.userData.orbitRadius;
    sprite.position.x = sprite.userData.basePosition.x + Math.cos(angle) * orbitRadius;
    sprite.position.z = sprite.userData.basePosition.z + Math.sin(angle) * orbitRadius;
  });
}

function updateHud() {
  if (!hudSpeed || !hudAccel) return;
  const speed = velocity.length();
  const accel = accelVector.length();
  hudSpeed.textContent = speed.toFixed(2);
  hudAccel.textContent = accel.toFixed(2);
}

initSpace();
addInteractions();
initI18n();
loadAstrBotContributors();
loadPluginContributors();

function initI18n() {
  const saved = localStorage.getItem("astrbot-lang");
  const detected =
    navigator.language && navigator.language.toLowerCase().startsWith("zh")
      ? "zh"
      : "en";
  currentLang = saved || detected;
  updateStaticText();
  toggleLangBtn.addEventListener("click", () => {
    currentLang = currentLang === "zh" ? "en" : "zh";
    localStorage.setItem("astrbot-lang", currentLang);
    updateStaticText();

    astrbotGrid.innerHTML = "";
    astrbotContributors.forEach((contributor, index) => {
      astrbotGrid.appendChild(createCard(contributor, index));
    });
    pluginsGrid.innerHTML = "";
    pluginContributors.forEach((contributor, index) => {
      pluginsGrid.appendChild(createCard(contributor, index));
    });
    if (astrbotContributors.length) {
      astrbotMeta.textContent = t("loadedContributors", {
        count: formatNumber(astrbotContributors.length),
      });
    }
    if (pluginContributors.length) {
      pluginsMeta.textContent = t("aggregated", {
        contributors: formatNumber(pluginContributors.length),
        repos: formatNumber(pluginRepoCount),
      });
    }
  });
}
