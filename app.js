/* ==========================================================================
   CUBDECOR | app.js
   Capas, en orden de ejecución:
     1. Configuración y utilidades
     2. WhatsApp (enlaces, formulario, botón flotante)
     3. Loader real (fuentes + imagen del hero + escena 3D)
     4. Hero 3D (Three.js, carga diferida con respaldo si falla)
     5. Scroll cinematográfico (Lenis + GSAP/ScrollTrigger)
     6. Interacciones (menú, colores, proceso, FAQ, imanes)
   Degradación: si GSAP, Lenis o WebGL fallan, la página sigue siendo
   completa y navegable (solo se pierden los efectos).
   ========================================================================== */
(() => {
    'use strict';

    /* ======================================================================
       1. CONFIGURACIÓN Y UTILIDADES
       ====================================================================== */
    const CONFIG = {
        // VERIFICAR con el cliente antes de publicar: formato internacional 52 + 10 dígitos.
        whatsapp: '525575277455',
        phoneDisplay: '55 7527 7455',
        threeUrl: 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js',
    };

    const root = document.documentElement;
    const $ = (s, c = document) => c.querySelector(s);
    const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const easeInOut = (t) => (t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

    const prefersReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const desktopMQ = matchMedia('(min-width: 960px)');
    const hasGSAP = !!(window.gsap && window.ScrollTrigger);

    let lenis = null;
    let heroScene = null;      // controlador de la escena 3D (si carga)
    let heroProgress = 0;      // progreso de scroll del hero (0 a 1)

    const waLink = (text) => `https://wa.me/${CONFIG.whatsapp}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

    /* ======================================================================
       2. WHATSAPP
       ====================================================================== */
    function initWhatsApp() {
        // Todos los enlaces con data-wa usan el número de CONFIG (una sola fuente de verdad)
        $$('[data-wa]').forEach((a) => { a.href = waLink(a.dataset.wa); });
        $$('[data-phone]').forEach((el) => { el.textContent = CONFIG.phoneDisplay; });
        const year = $('#year'); if (year) year.textContent = new Date().getFullYear();
        const fallback = $('#form-fallback'); if (fallback) fallback.href = waLink('Hola Cubdecor, quiero mi cotización.');
    }

    function initForm() {
        const form = $('#wa-form'); if (!form) return;
        const submit = $('#form-submit');
        const ok = $('#form-ok');
        const rules = {
            name: { el: $('#f-name'), err: $('#f-name-err'), msg: 'Escribe tu nombre para poder atenderte.', test: (v) => v.trim().length >= 2 },
            type: { el: $('#f-type'), err: $('#f-type-err'), msg: 'Elige qué vas a transformar.', test: (v) => v !== '' },
        };
        const setError = (r, on) => {
            r.el.closest('.field').classList.toggle('has-error', on);
            r.el.setAttribute('aria-invalid', on ? 'true' : 'false');
            r.err.textContent = on ? r.msg : '';
        };
        Object.values(rules).forEach((r) => {
            ['input', 'change'].forEach((ev) => r.el.addEventListener(ev, () => { if (r.test(r.el.value)) setError(r, false); }));
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            let firstBad = null;
            Object.values(rules).forEach((r) => {
                const bad = !r.test(r.el.value);
                setError(r, bad);
                if (bad && !firstBad) firstBad = r.el;
            });
            if (firstBad) { firstBad.focus(); return; }

            const name = rules.name.el.value.trim();
            const type = rules.type.el.value;
            const size = $('#f-size').value.trim();
            const msg = $('#f-msg').value.trim();
            const lines = [`Hola Cubdecor, soy ${name}.`, `Quiero cotizar: ${type}.`];
            if (size) lines.push(`Medidas aproximadas: ${size}.`);
            if (msg) lines.push(`Detalles: ${msg}`);
            lines.push('Quedo atento a su respuesta.');
            const url = waLink(lines.join('\n'));

            // Se abre en el mismo gesto del usuario para que los navegadores no bloqueen la ventana
            const win = window.open(url, '_blank', 'noopener');
            $('#form-fallback').href = url;
            submit.classList.add('is-loading');
            setTimeout(() => {
                submit.classList.remove('is-loading');
                ok.hidden = false;
                if (!win) ok.querySelector('span').textContent = 'Tu mensaje está listo.';
                form.reset();
            }, 800);
        });
    }

    function initFloat() {
        const fab = $('#wa-float'); if (!fab) return;
        setTimeout(() => fab.classList.add('is-visible'), 2600);
        setTimeout(() => fab.classList.add('show-tip'), 6500);
        setTimeout(() => fab.classList.remove('show-tip'), 11500);
    }

    /* ======================================================================
       3. LOADER
       Progreso real: fuentes + imagen del hero + escena 3D (con tope de espera).
       Dura un mínimo para que se vea dibujarse el cubo de la marca.
       ====================================================================== */
    function supportsWebGL() {
        try {
            const c = document.createElement('canvas');
            return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
        } catch (_) { return false; }
    }

    function loadThree() {
        const saveData = navigator.connection && navigator.connection.saveData;
        if (!supportsWebGL() || saveData) return Promise.resolve(null);
        return import(CONFIG.threeUrl).catch(() => null);
    }

    function runLoader(threePromise) {
        return new Promise((resolve) => {
            const loader = $('#loader');
            if (!loader) { resolve(); return; }
            const countEl = $('#loader-count');
            const barEl = $('#loader-bar');
            const MIN_MS = prefersReduced ? 500 : 2700;
            const MAX_THREE_WAIT = 6000;
            const t0 = performance.now();

            const heroImg = $('.hero__photo img');
            const tasks = [
                document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
                new Promise((r) => { if (!heroImg || heroImg.complete) r(); else { heroImg.addEventListener('load', r, { once: true }); heroImg.addEventListener('error', r, { once: true }); } }),
                Promise.race([threePromise, new Promise((r) => setTimeout(r, MAX_THREE_WAIT))]),
                new Promise((r) => { if (document.readyState === 'complete') r(); else window.addEventListener('load', r, { once: true }); }),
            ];
            let done = 0;
            tasks.forEach((p) => p.catch(() => {}).then(() => { done += 1; }));

            let shown = 0;
            let finished = false;
            const tick = (now) => {
                const timeP = clamp((now - t0) / MIN_MS, 0, 1);
                const realP = done / tasks.length;
                const target = Math.min(easeInOut(timeP), realP) * 100;
                shown += (target - shown) * .14;
                if (target >= 99.9 && shown > 99.4) shown = 100;
                const n = Math.round(shown);
                if (countEl.textContent !== String(n)) countEl.textContent = n;
                barEl.style.transform = `scaleX(${shown / 100})`;

                if (shown >= 100 && !finished) {
                    finished = true;
                    setTimeout(() => {
                        loader.classList.add('is-done');
                        setTimeout(resolve, 380);
                        setTimeout(() => loader.classList.add('is-gone'), 1250);
                    }, 280);
                    return;
                }
                if (!finished) requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        });
    }

    /* ======================================================================
       4. HERO 3D
       Una losa de Corian en L con tarja integrada (textura moteada tipo
       terrazo, 12 mm exagerados para que se lea el espesor) flota dentro del
       cubo de alambre rojo de la marca. Se mueve siempre (oscilación, flotación,
       partículas de mineral, pulsos de luz en las aristas) y responde al cursor
       y al scroll (la cámara entra al cubo).
       ====================================================================== */
    function mulberry32(a) {
        return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    }

    function buildHero3D(THREE, hero) {
        const sticky = $('.hero__sticky', hero);
        const canvas = $('#hero-canvas');
        const spec = $('#hero-spec');
        if (spec && spec.parentElement !== sticky) sticky.appendChild(spec); // coordenadas relativas al hero

        const fade = document.createElement('div');
        fade.className = 'hero__fade';
        sticky.insertBefore(fade, $('.hero__inner', sticky));

        const lowPower = matchMedia('(max-width: 767px)').matches || (navigator.hardwareConcurrency || 8) <= 4;
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, alpha: true, powerPreference: 'high-performance' });
        renderer.setClearColor(0x000000, 0);
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.12;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(32, 1, .1, 100);

        /* --- Entorno de estudio (reflejos del Corian y del cromo) --- */
        const pmrem = new THREE.PMREMGenerator(renderer);
        const envScene = new THREE.Scene();
        envScene.add(new THREE.Mesh(new THREE.SphereGeometry(30, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0b0b0f, side: THREE.BackSide })));
        const softbox = (w, h, color, k, pos) => {
            const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
            m.position.set(...pos); m.lookAt(0, 0, 0); envScene.add(m);
        };
        softbox(18, 10, 0xffffff, 3.4, [0, 14, 4]);
        softbox(5, 14, 0xff2a1c, 2.4, [-14, 2, 2]);
        softbox(8, 8, 0xdfe6ff, 1.7, [12, 4, -6]);
        softbox(16, 4, 0xffffff, 1.3, [0, -3, 14]);
        scene.environment = pmrem.fromScene(envScene, 0.035).texture;
        pmrem.dispose();

        scene.add(new THREE.AmbientLight(0xffffff, .3));
        const key = new THREE.DirectionalLight(0xfff3ea, 2.1); key.position.set(3, 8, 6); scene.add(key);
        const redLight = new THREE.PointLight(0xff2a1a, 16, 20, 2); redLight.position.set(-5, -1.5, 3); scene.add(redLight);

        const rig = new THREE.Group(); scene.add(rig);
        const cubeGroup = new THREE.Group(); rig.add(cubeGroup);
        const slabGroup = new THREE.Group(); rig.add(slabGroup);

        /* --- Cubo de alambre: aristas con pulso de luz viajando --- */
        const timeU = { value: 0 };
        const S = 5.4, H = S / 2, T = .022;
        const edgeGeo = new THREE.BoxGeometry(T, T, S + T);
        const haloGeo = new THREE.BoxGeometry(T * 5, T * 5, S + T);
        const haloMat = new THREE.MeshBasicMaterial({ color: 0xff1a10, transparent: true, opacity: .07, blending: THREE.AdditiveBlending, depthWrite: false });
        const edgeVert = `varying float vT; uniform float uLen; void main(){ vT = position.z / uLen + .5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
        const edgeFrag = `varying float vT; uniform float uTime; uniform float uPhase; void main(){
            float x = fract(vT - uTime * .16 - uPhase);
            float pulse = exp(-pow((x - .5) * 8.0, 2.0));
            vec3 base = vec3(.86, .07, .06);
            vec3 hot = vec3(1.0, .62, .52);
            gl_FragColor = vec4(mix(base, hot, pulse), .78 + .22 * pulse);
        }`;
        const edgeDefs = [];
        [-1, 1].forEach((a) => [-1, 1].forEach((b) => {
            edgeDefs.push({ pos: [a * H, b * H, 0], rot: [0, 0, 0] });
            edgeDefs.push({ pos: [0, a * H, b * H], rot: [0, Math.PI / 2, 0] });
            edgeDefs.push({ pos: [a * H, 0, b * H], rot: [Math.PI / 2, 0, 0] });
        }));
        edgeDefs.forEach((d, i) => {
            const mat = new THREE.ShaderMaterial({ vertexShader: edgeVert, fragmentShader: edgeFrag, transparent: true, depthWrite: false, uniforms: { uTime: timeU, uLen: { value: S + T }, uPhase: { value: i * .137 } } });
            const bar = new THREE.Mesh(edgeGeo, mat); bar.position.set(...d.pos); bar.rotation.set(...d.rot); cubeGroup.add(bar);
            if (!lowPower) { const halo = new THREE.Mesh(haloGeo, haloMat); halo.position.set(...d.pos); halo.rotation.set(...d.rot); cubeGroup.add(halo); }
        });
        const nodeGeo = new THREE.BoxGeometry(.09, .09, .09);
        const nodeMat = new THREE.MeshBasicMaterial({ color: 0xff4d42 });
        [-1, 1].forEach((x) => [-1, 1].forEach((y) => [-1, 1].forEach((z) => {
            const n = new THREE.Mesh(nodeGeo, nodeMat); n.position.set(x * H, y * H, z * H); cubeGroup.add(n);
        })));

        /* --- Textura moteada tipo terrazo (procedural, repetible) --- */
        const rand = mulberry32(20261022);
        const texCanvas = document.createElement('canvas'); texCanvas.width = texCanvas.height = 1024;
        const g = texCanvas.getContext('2d');
        g.fillStyle = '#eeede8'; g.fillRect(0, 0, 1024, 1024);
        const palette = ['#c9bfae', '#b8a58c', '#9a8267', '#8b8e91', '#ffffff', '#ddd8cc', '#a39a8c'];
        const fleck = (x, y, r, color, alpha) => {
            g.fillStyle = color; g.globalAlpha = alpha; g.beginPath();
            const n = 5; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + rand(); const rr = r * (.6 + rand() * .7); g[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
            g.closePath(); g.fill();
        };
        for (let i = 0; i < 3200; i++) fleck(rand() * 1024, rand() * 1024, 1 + rand() * 3, palette[(rand() * palette.length) | 0], .45 + rand() * .45);
        for (let i = 0; i < 110; i++) fleck(rand() * 1024, rand() * 1024, 4 + rand() * 5, palette[1 + ((rand() * 3) | 0)], .5 + rand() * .3);
        g.globalAlpha = 1;
        const speck = new THREE.CanvasTexture(texCanvas);
        speck.wrapS = speck.wrapT = THREE.RepeatWrapping;
        speck.colorSpace = THREE.SRGBColorSpace;
        speck.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        speck.repeat.set(.34, .34);

        const corian = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: speck, roughness: .4, metalness: 0, clearcoat: .35, clearcoatRoughness: .28, envMapIntensity: 1.05 });
        const corianPlain = new THREE.MeshPhysicalMaterial({ color: 0xf4f3ef, roughness: .38, clearcoat: .3, clearcoatRoughness: .3, envMapIntensity: 1.0 });

        /* --- Losa en L con tarja integrada --- */
        const roundedPoly = (pts, r) => {
            const s = new THREE.Shape(); const n = pts.length;
            for (let i = 0; i < n; i++) {
                const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n];
                const v1 = new THREE.Vector2().subVectors(p0, p1).normalize();
                const v2 = new THREE.Vector2().subVectors(p2, p1).normalize();
                const a = p1.clone().addScaledVector(v1, r), b = p1.clone().addScaledVector(v2, r);
                if (i === 0) s.moveTo(a.x, a.y); else s.lineTo(a.x, a.y);
                s.quadraticCurveTo(p1.x, p1.y, b.x, b.y);
            }
            s.closePath(); return s;
        };
        const V = (x, y) => new THREE.Vector2(x, y);
        const W = 3.5, D = 2.8, LEG = 1.0;                       // medidas de la L
        const hole = { x0: 1.9, x1: 3.05, y0: .24, y1: LEG - .24 }; // tarja en el tramo largo
        const rect = (x0, y0, x1, y1, r) => roundedPoly([V(x0, y0), V(x1, y0), V(x1, y1), V(x0, y1)], r);
        const outline = roundedPoly([V(0, 0), V(W, 0), V(W, LEG), V(LEG, LEG), V(LEG, D), V(0, D)], .07);
        outline.holes.push(rect(hole.x0, hole.y0, hole.x1, hole.y1, .12));

        const DEPTH = .15, BT = .02;
        const cx = W / 2, cy = D / 2, topY = DEPTH / 2 + BT;
        const place = (geo, zShift = 0) => { geo.translate(-cx, -cy, -DEPTH / 2 + zShift); geo.rotateX(-Math.PI / 2); return geo; };

        const slabGeo = place(new THREE.ExtrudeGeometry(outline, { depth: DEPTH, bevelEnabled: true, bevelThickness: BT, bevelSize: BT, bevelSegments: 4, curveSegments: 14 }));
        slabGroup.add(new THREE.Mesh(slabGeo, corian));

        // Cuba de la tarja (paredes + fondo), del mismo material.
        // Su borde superior queda 4 milésimas bajo la cara superior de la losa para evitar parpadeo (z-fighting).
        const BASIN = .46;
        const basinShift = topY - .004 - BASIN + DEPTH / 2;
        const wallShape = rect(hole.x0 - .03, hole.y0 - .03, hole.x1 + .03, hole.y1 + .03, .13);
        wallShape.holes.push(rect(hole.x0 + .035, hole.y0 + .035, hole.x1 - .035, hole.y1 - .035, .09));
        slabGroup.add(new THREE.Mesh(place(new THREE.ExtrudeGeometry(wallShape, { depth: BASIN, bevelEnabled: false, curveSegments: 14 }), basinShift), corianPlain));
        slabGroup.add(new THREE.Mesh(place(new THREE.ExtrudeGeometry(rect(hole.x0, hole.y0, hole.x1, hole.y1, .12), { depth: .03, bevelEnabled: false, curveSegments: 14 }), basinShift), corianPlain));

        const holeCx = (hole.x0 + hole.x1) / 2 - cx;
        const holeCz = -((hole.y0 + hole.y1) / 2 - cy);
        const drain = new THREE.Mesh(new THREE.CircleGeometry(.045, 24), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, metalness: .8, roughness: .35 }));
        drain.rotation.x = -Math.PI / 2; drain.position.set(holeCx, topY - .004 - BASIN + .034, holeCz); slabGroup.add(drain);

        // Grifo cromado (cuello de ganso)
        const chrome = new THREE.MeshStandardMaterial({ color: 0xe6e6e6, metalness: 1, roughness: .1, envMapIntensity: 1.5 });
        const neck = new THREE.CatmullRomCurve3([V3(0, 0, 0), V3(0, .5, 0), V3(0, .74, .04), V3(0, .82, .24), V3(0, .76, .46), V3(0, .6, .54)]);
        function V3(x, y, z) { return new THREE.Vector3(x, y, z); }
        const faucet = new THREE.Group();
        faucet.add(new THREE.Mesh(new THREE.TubeGeometry(neck, 48, .034, 14, false), chrome));
        faucet.add(new THREE.Mesh(new THREE.CylinderGeometry(.075, .085, .1, 24), chrome));
        faucet.position.set(holeCx, topY + .05, holeCz - ((hole.y1 - hole.y0) / 2) - .16);
        slabGroup.add(faucet);

        // Punto de anclaje del rótulo "12 mm": esquina frontal derecha del tramo largo
        const marker = new THREE.Object3D();
        marker.position.set(W - cx, 0, cy);
        slabGroup.add(marker);

        /* --- Partículas de mineral (cuadritos, como las motas del material) --- */
        const COUNT = lowPower ? 380 : 900;
        const pos = new Float32Array(COUNT * 3), col = new Float32Array(COUNT * 3);
        const tones = [[.88, .85, .8], [.88, .85, .8], [.88, .85, .8], [.72, .6, .45], [.55, .55, .58], [1, .25, .2]];
        for (let i = 0; i < COUNT; i++) {
            const r = 3.4 + rand() * 7.5, th = rand() * Math.PI * 2, ph = Math.acos(2 * rand() - 1);
            pos[i * 3] = r * Math.sin(ph) * Math.cos(th); pos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th) * .8; pos[i * 3 + 2] = r * Math.cos(ph);
            const c = tones[(rand() * tones.length) | 0]; col.set(c, i * 3);
        }
        const dustGeo = new THREE.BufferGeometry();
        dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        dustGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: .055, sizeAttenuation: true, vertexColors: true, transparent: true, opacity: .85, depthWrite: false }));
        rig.add(dust);

        /* --- Tamaño, encuadre y bucle --- */
        const state = { w: 1, h: 1, scroll: 0, scrollTarget: 0, mx: 0, my: 0, mxT: 0, myT: 0, running: false, raf: 0, t0: performance.now(), visible: true };
        const projected = new THREE.Vector3();

        const resize = () => {
            const w = sticky.clientWidth, h = sticky.clientHeight;
            if (!w || !h) return;
            state.w = w; state.h = h;
            renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2));
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            const wide = w / h > 1.15;
            // Encuadre fuera de eje (sin deformar): escritorio a la derecha, móvil arriba
            camera.setViewOffset(w, h, wide ? -w * .17 : 0, wide ? 0 : h * .15, w, h);
            const s = clamp((w / h) * 1.3, .6, 1);
            rig.scale.setScalar(s);
            camera.updateProjectionMatrix();
        };
        new ResizeObserver(resize).observe(sticky);
        resize();

        const render = (now) => {
            const t = (now - state.t0) / 1000;
            timeU.value = t;
            state.scroll = lerp(state.scroll, state.scrollTarget, .085);
            state.mx = lerp(state.mx, state.mxT, .05);
            state.my = lerp(state.my, state.myT, .05);
            const p = state.scroll;

            cubeGroup.rotation.y = t * .085;
            cubeGroup.rotation.x = .36 + Math.sin(t * .3) * .035;
            slabGroup.rotation.y = -.42 + Math.sin(t * .42) * .5;
            slabGroup.rotation.x = Math.sin(t * .33) * .05;
            slabGroup.position.y = Math.sin(t * .9) * .09;
            dust.rotation.y = t * .018; dust.rotation.x = t * .006;
            rig.rotation.y = state.mx * .28; rig.rotation.x = state.my * .12;

            const e = easeInOut(p);
            camera.position.set(0, lerp(2.3, .9, e), lerp(16, 4.6, e));
            camera.lookAt(0, 0, 0);
            fade.style.opacity = String(smoothstep(.72, .98, p));

            renderer.render(scene, camera);

            if (spec) {
                marker.getWorldPosition(projected).project(camera);
                const x = (projected.x * .5 + .5) * state.w, y = (-projected.y * .5 + .5) * state.h;
                const intro = clamp((now - state.t0) / 1800 - .6, 0, 1);
                spec.style.transform = `translate3d(${(x + 10).toFixed(1)}px, ${(y - 7).toFixed(1)}px, 0)`;
                spec.style.opacity = String(intro * (1 - clamp(p * 8, 0, 1)));
            }
        };
        const loop = (now) => { render(now); state.raf = requestAnimationFrame(loop); };
        const start = () => { if (state.running || prefersReduced) return; state.running = true; state.raf = requestAnimationFrame(loop); };
        const stop = () => { state.running = false; cancelAnimationFrame(state.raf); };

        if (spec) spec.style.transition = 'none';
        hero.classList.add('is-3d');
        if (prefersReduced) { render(state.t0 + 1500); } else { start(); }

        if (finePointer && !prefersReduced) {
            sticky.addEventListener('pointermove', (e) => {
                const r = sticky.getBoundingClientRect();
                state.mxT = ((e.clientX - r.left) / r.width - .5) * 2;
                state.myT = ((e.clientY - r.top) / r.height - .5) * 2;
            });
            sticky.addEventListener('pointerleave', () => { state.mxT = 0; state.myT = 0; });
        }
        new IntersectionObserver(([entry]) => { state.visible = entry.isIntersecting; if (entry.isIntersecting && !document.hidden) start(); else stop(); }, { threshold: 0 }).observe(hero);
        document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (state.visible) start(); });
        canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stop(); hero.classList.remove('is-3d'); hero.classList.add('no-3d'); });

        return { setProgress: (v) => { state.scrollTarget = clamp(v, 0, 1); } };
    }

    /* ======================================================================
       5. SCROLL CINEMATOGRÁFICO
       ====================================================================== */
    function initLenis() {
        if (!window.Lenis || prefersReduced) return;
        lenis = new window.Lenis({ duration: 1.25, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)), smoothWheel: true });
        if (hasGSAP) {
            lenis.on('scroll', window.ScrollTrigger.update);
            window.gsap.ticker.add((time) => lenis.raf(time * 1000));
            window.gsap.ticker.lagSmoothing(0);
        } else {
            const raf = (time) => { lenis.raf(time); requestAnimationFrame(raf); };
            requestAnimationFrame(raf);
        }
    }

    function scrollToTarget(target) {
        if (lenis) lenis.scrollTo(target, { duration: 1.8, easing: (t) => 1 - Math.pow(1 - t, 4) });
        else target.scrollIntoView({ behavior: prefersReduced ? 'auto' : 'smooth', block: 'start' });
    }

    function splitWords(el) {
        const words = [];
        const walk = (node) => {
            Array.from(node.childNodes).forEach((child) => {
                if (child.nodeType === 3) {
                    const frag = document.createDocumentFragment();
                    child.textContent.split(/(\s+)/).forEach((part) => {
                        if (!part) return;
                        if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
                        const s = document.createElement('span'); s.className = 'w'; s.textContent = part; frag.appendChild(s); words.push(s);
                    });
                    child.replaceWith(frag);
                } else if (child.nodeType === 1) walk(child);
            });
        };
        walk(el);
        return words;
    }

    function initReveals() {
        if (!root.classList.contains('reveal-on')) return;
        $$('.h2').forEach((h) => { splitWords(h).forEach((w, i) => w.style.setProperty('--wi', i)); });
        $$('.bento__grid .cell').forEach((c, i) => c.style.setProperty('--d', `${(i % 3) * .08}s`));
        const giant = $('.footer__giant'); if (giant) giant.setAttribute('data-reveal', '');
        const io = new IntersectionObserver((entries, o) => entries.forEach((e) => {
            if (e.isIntersecting) { e.target.classList.add('is-in'); o.unobserve(e.target); }
        }), { threshold: .12, rootMargin: '0px 0px -6% 0px' });
        $$('[data-reveal], .h2').forEach((el) => io.observe(el));
    }

    function initScrollEffects() {
        if (!hasGSAP || prefersReduced) return;
        const { gsap, ScrollTrigger } = window;
        const hero = $('#inicio');

        // Barra de progreso de lectura
        gsap.to('#progress-bar', { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: .3 } });

        // Hero: la cámara entra al cubo mientras el texto se retira
        ScrollTrigger.create({ trigger: hero, start: 'top top', end: 'bottom bottom', onUpdate: (s) => { heroProgress = s.progress; if (heroScene) heroScene.setProgress(heroProgress); } });
        gsap.to('.hero__inner', { yPercent: -14, opacity: 0, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: '+=55%', scrub: true } });
        gsap.to('.hero__photo', { opacity: .0, ease: 'none', scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom bottom', scrub: true } });

        // Marquee que reacciona a la velocidad del scroll
        const track = $('#ticker-track');
        if (track && lenis) {
            track.parentElement.classList.add('is-js');
            const tween = gsap.to(track, { xPercent: -50, duration: 52, ease: 'none', repeat: -1 });
            let settle;
            lenis.on('scroll', ({ velocity }) => {
                const v = clamp(velocity, -40, 40);
                const target = (v >= 0 ? 1 : -1) * (1 + Math.abs(v) * .22);
                tween.timeScale(lerp(tween.timeScale(), target, .25));
                clearTimeout(settle);
                settle = setTimeout(() => gsap.to(tween, { timeScale: 1, duration: 1.4, ease: 'power2.out' }), 120);
            });
        }

        // Manifiesto: las palabras se encienden con el scroll
        const manifesto = $('.manifesto');
        const mText = $('#manifesto-text');
        if (manifesto && mText) {
            const words = splitWords(mText);
            gsap.timeline({ scrollTrigger: { trigger: manifesto, start: 'top top', end: 'bottom bottom', scrub: true } })
                .to(words, { opacity: 1, ease: 'none', stagger: { each: .12 }, duration: .35 });
            gsap.fromTo('.manifesto__cube', { rotate: -10, yPercent: 12 }, { rotate: 12, yPercent: -12, ease: 'none', scrollTrigger: { trigger: manifesto, start: 'top bottom', end: 'bottom top', scrub: true } });
        }

        // Bento: paralaje de las fotos y contador de 12 mm
        $$('.cell--img').forEach((cell) => {
            const img = $('img', cell);
            gsap.fromTo(img, { yPercent: -4.5 }, { yPercent: 4.5, ease: 'none', scrollTrigger: { trigger: cell, start: 'top bottom', end: 'bottom top', scrub: true } });
        });
        const counter = $('.count[data-count]');
        if (counter) {
            const obj = { v: 0 }; const target = Number(counter.dataset.count);
            counter.textContent = '0';
            gsap.to(obj, { v: target, duration: 1.8, ease: 'power3.out', onUpdate: () => { counter.textContent = Math.round(obj.v); }, scrollTrigger: { trigger: counter, start: 'top 85%', once: true } });
        }

        // La imagen del proyecto destacado "se abre" a pantalla completa
        const mm = gsap.matchMedia();
        mm.add({ narrow: '(max-width: 767px)', wide: '(min-width: 768px)' }, (ctx) => {
            const frame = $('#expand-frame'); if (!frame) return;
            const { narrow } = ctx.conditions;
            const from = narrow ? 'inset(27% 9% 27% 9% round 4px)' : 'inset(31% 29% 31% 29% round 4px)';
            const tl = gsap.timeline({ scrollTrigger: { trigger: '.expand', start: 'top top', end: 'bottom bottom', scrub: .6 } });
            tl.fromTo(frame, { clipPath: from }, { clipPath: 'inset(0% 0% 0% 0% round 0px)', ease: 'none', duration: .62 }, 0)
              .fromTo($('img', frame), { scale: 1.45 }, { scale: 1, ease: 'none', duration: 1 }, 0)
              .to('.expand__word--l', { yPercent: -160, opacity: 0, ease: 'none', duration: .5 }, 0.05)
              .to('.expand__word--r', { yPercent: 160, opacity: 0, ease: 'none', duration: .5 }, 0.05)
              .fromTo('.expand__caption', { opacity: 0, y: 34 }, { opacity: 1, y: 0, ease: 'none', duration: .22 }, .72);
        });

        // Galería horizontal anclada (solo escritorio; en móvil se desliza con el dedo)
        mm.add('(min-width: 960px)', () => {
            const wrap = $('.hgallery'), trackEl = $('#hg-track'), viewport = $('.hgallery__viewport'), bar = $('#hg-progress');
            if (!wrap || !trackEl) return;
            const travel = () => {
                const pad = parseFloat(getComputedStyle(viewport).paddingLeft) || 0;
                return Math.max(0, trackEl.scrollWidth - (window.innerWidth - pad * 2));
            };
            const setHeight = () => wrap.style.setProperty('--hg-h', `${window.innerHeight + travel()}px`);
            setHeight();
            ScrollTrigger.addEventListener('refreshInit', setHeight);
            gsap.to(trackEl, { x: () => -travel(), ease: 'none', scrollTrigger: { trigger: wrap, start: 'top top', end: 'bottom bottom', scrub: .6, invalidateOnRefresh: true, onUpdate: (s) => { bar.style.transform = `scaleX(${s.progress})`; } } });
            return () => { ScrollTrigger.removeEventListener('refreshInit', setHeight); wrap.style.removeProperty('--hg-h'); };
        });

        window.addEventListener('load', () => ScrollTrigger.refresh());
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => ScrollTrigger.refresh());
    }

    /* ======================================================================
       6. INTERACCIONES
       ====================================================================== */
    function initNav() {
        const nav = $('#nav'); if (!nav) return;
        // Estado "scrolled" con un centinela (sin escuchar el scroll de la ventana)
        const sentinel = document.createElement('div');
        sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:24px;pointer-events:none';
        document.body.prepend(sentinel);
        new IntersectionObserver(([e]) => nav.classList.toggle('is-scrolled', !e.isIntersecting)).observe(sentinel);

        // Ocultar al bajar, mostrar al subir (solo con Lenis)
        if (lenis) {
            lenis.on('scroll', ({ scroll, direction }) => {
                if (nav.classList.contains('is-menu-open')) return;
                nav.classList.toggle('is-hidden', direction === 1 && scroll > 700);
            });
        }

        // Sección activa en el menú
        const map = { material: 'material', ventajas: 'material', proyectos: 'proyectos', colores: 'colores', catalogos: 'catalogos', proceso: 'proceso', preguntas: 'preguntas' };
        const links = $$('.nav__links a');
        const io = new IntersectionObserver((entries) => entries.forEach((e) => {
            if (!e.isIntersecting) return;
            const key = map[e.target.id];
            links.forEach((a) => a.classList.toggle('is-active', a.getAttribute('href') === `#${key}`));
        }), { rootMargin: '-45% 0px -50% 0px' });
        Object.keys(map).forEach((id) => { const s = document.getElementById(id); if (s) io.observe(s); });
        const heroEl = $('#inicio');
        if (heroEl) new IntersectionObserver(([e]) => { if (e.isIntersecting) links.forEach((a) => a.classList.remove('is-active')); }, { rootMargin: '-40% 0px -40% 0px' }).observe(heroEl);
    }

    function initMenu() {
        const toggle = $('#menu-toggle'), menu = $('#menu'), nav = $('#nav'); if (!toggle || !menu) return;
        $$('.menu__link', menu).forEach((a, i) => a.style.setProperty('--i', i));
        let open = false;
        const setOpen = (v) => {
            open = v;
            toggle.setAttribute('aria-expanded', String(v));
            toggle.setAttribute('aria-label', v ? 'Cerrar menú' : 'Abrir menú');
            nav.classList.toggle('is-menu-open', v);
            if (v) {
                nav.classList.remove('is-hidden');
                menu.hidden = false;
                requestAnimationFrame(() => requestAnimationFrame(() => menu.classList.add('is-open')));
                if (lenis) lenis.stop(); else document.body.style.overflow = 'hidden';
            } else {
                menu.classList.remove('is-open');
                setTimeout(() => { if (!open) menu.hidden = true; }, 520);
                if (lenis) lenis.start(); else document.body.style.overflow = '';
            }
        };
        toggle.addEventListener('click', () => setOpen(!open));
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) { setOpen(false); toggle.focus(); } });
        $$('a', menu).forEach((a) => a.addEventListener('click', () => setOpen(false)));
        desktopMQ.addEventListener('change', () => { if (open && matchMedia('(min-width: 1100px)').matches) setOpen(false); });
    }

    function initAnchors() {
        document.addEventListener('click', (e) => {
            const a = e.target.closest('a[href^="#"]'); if (!a) return;
            const id = a.getAttribute('href'); if (id.length < 2) return;
            const target = document.querySelector(id); if (!target) return;
            e.preventDefault();
            // Dar un instante al menú para cerrarse antes de desplazar
            setTimeout(() => scrollToTarget(target), a.closest('.menu') ? 260 : 0);
        });
    }

    function initColors() {
        const stage = $('#stage'); if (!stage) return;
        const imgs = $$('img', stage), chips = $$('.swatch'), group = $('#swatches');
        const nameEl = $('#tone-name'), textEl = $('#tone-text'), cta = $('#tone-cta'), tone = $('.tone');
        let current = 'Blanco', cleanup = 0, swap = 0;
        chips.forEach((c, i) => { c.tabIndex = i === 0 ? 0 : -1; });

        const select = (chip) => {
            const name = chip.dataset.tone; if (name === current) return; current = name;
            chips.forEach((c) => { const on = c === chip; c.classList.toggle('is-active', on); c.setAttribute('aria-checked', String(on)); c.tabIndex = on ? 0 : -1; });

            // La imagen nueva se abre en círculo desde el lado de los botones
            const cr = chip.getBoundingClientRect(), sr = stage.getBoundingClientRect();
            const wide = desktopMQ.matches;
            stage.style.setProperty('--cx', wide ? '100%' : `${clamp(((cr.left + cr.width / 2 - sr.left) / sr.width) * 100, 0, 100)}%`);
            stage.style.setProperty('--cy', wide ? `${clamp(((cr.top + cr.height / 2 - sr.top) / sr.height) * 100, 0, 100)}%` : '100%');

            const next = imgs.find((i) => i.dataset.tone === name);
            const prev = imgs.find((i) => i.classList.contains('is-active'));
            imgs.forEach((i) => i.classList.remove('is-prev'));
            if (prev) { prev.classList.remove('is-active'); prev.classList.add('is-prev'); }
            next.style.transition = 'none'; next.classList.remove('is-active'); void next.offsetWidth; next.style.transition = '';
            next.classList.add('is-active');
            clearTimeout(cleanup); cleanup = setTimeout(() => imgs.forEach((i) => i.classList.remove('is-prev')), 1250);

            tone.classList.add('is-swapping');
            clearTimeout(swap);
            swap = setTimeout(() => { nameEl.textContent = name; textEl.textContent = chip.dataset.text; tone.classList.remove('is-swapping'); }, 260);

            cta.dataset.wa = `Hola Cubdecor, me interesa una cubierta en color ${name}. ¿Me ayudan a cotizar?`;
            cta.href = waLink(cta.dataset.wa);
        };

        chips.forEach((c) => c.addEventListener('click', () => select(c)));
        group.addEventListener('keydown', (e) => {
            const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
            if (!(e.key in keys)) return;
            e.preventDefault();
            const i = chips.findIndex((c) => c.classList.contains('is-active'));
            const n = chips[(i + keys[e.key] + chips.length) % chips.length];
            n.focus(); select(n);
        });
    }

    function initProcess() {
        const steps = $$('.step'); const figure = $('#process-figure'); if (!steps.length || !figure) return;
        const imgs = $$('img', figure), prog = $('#process-progress');
        let active = 0, cleanup = 0;
        const set = (i) => {
            if (i === active) return;
            const prev = imgs[active], next = imgs[i];
            imgs.forEach((m) => m.classList.remove('is-prev'));
            prev.classList.remove('is-active'); prev.classList.add('is-prev');
            next.style.transition = 'none'; next.classList.remove('is-active'); void next.offsetWidth; next.style.transition = '';
            next.classList.add('is-active');
            clearTimeout(cleanup); cleanup = setTimeout(() => imgs.forEach((m) => m.classList.remove('is-prev')), 1250);
            steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
            prog.style.transform = `scaleX(${(i + 1) / steps.length})`;
            active = i;
        };
        prog.style.transform = `scaleX(${1 / steps.length})`;
        const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) set(steps.indexOf(e.target)); }), { rootMargin: '-46% 0px -46% 0px' });
        steps.forEach((s) => io.observe(s));
    }

    function initFaq() {
        const items = $$('.qa'); if (!items.length) return;
        const open = (qa, v) => {
            qa.classList.toggle('is-open', v);
            $('.qa__q', qa).setAttribute('aria-expanded', String(v));
        };
        items.forEach((qa) => $('.qa__q', qa).addEventListener('click', () => {
            const willOpen = !qa.classList.contains('is-open');
            items.forEach((o) => open(o, false));
            open(qa, willOpen);
        }));
        open(items[0], true);
    }

    function initMagnetic() {
        if (!finePointer || prefersReduced) return;
        $$('[data-magnetic]').forEach((el) => {
            el.addEventListener('pointermove', (e) => {
                const r = el.getBoundingClientRect();
                el.style.setProperty('--tx', `${((e.clientX - (r.left + r.width / 2)) * .2).toFixed(1)}px`);
                el.style.setProperty('--ty', `${((e.clientY - (r.top + r.height / 2)) * .28).toFixed(1)}px`);
            });
            el.addEventListener('pointerleave', () => { el.style.setProperty('--tx', '0px'); el.style.setProperty('--ty', '0px'); });
        });
    }

    function initSpotlight() {
        if (!finePointer) return;
        $$('.cell').forEach((c) => c.addEventListener('pointermove', (e) => {
            const r = c.getBoundingClientRect();
            c.style.setProperty('--mx', `${e.clientX - r.left}px`);
            c.style.setProperty('--my', `${e.clientY - r.top}px`);
        }));
    }

    /* ======================================================================
       ARRANQUE
       ====================================================================== */
    function init() {
        root.classList.add('js');
        if (!prefersReduced && 'IntersectionObserver' in window) root.classList.add('reveal-on');
        if (hasGSAP && !prefersReduced) {
            root.classList.add('scrub-on');
            window.gsap.registerPlugin(window.ScrollTrigger);
            window.ScrollTrigger.config({ ignoreMobileResize: true });
        }
        const syncDesktop = () => root.classList.toggle('is-desktop', desktopMQ.matches);
        syncDesktop();
        desktopMQ.addEventListener('change', () => { syncDesktop(); if (hasGSAP) window.ScrollTrigger.refresh(); });

        initWhatsApp();
        initForm();
        initMenu();
        initAnchors();
        initColors();
        initProcess();
        initFaq();
        initMagnetic();
        initSpotlight();

        const threePromise = loadThree();
        const hero = $('#inicio');

        runLoader(threePromise).then(() => {
            root.classList.add('is-ready');
            document.body.classList.remove('is-loading');
            initLenis();
            initNav();
            initReveals();
            initFloat();
            initScrollEffects();

            // La escena 3D puede tardar más que el loader: entra cuando esté lista
            threePromise.then((THREE) => {
                if (!THREE || !hero) { if (hero) hero.classList.add('no-3d'); return; }
                try {
                    heroScene = buildHero3D(THREE, hero);
                    heroScene.setProgress(heroProgress);
                } catch (err) {
                    console.warn('Hero 3D no disponible:', err);
                    hero.classList.remove('is-3d');
                    hero.classList.add('no-3d');
                }
            });
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
