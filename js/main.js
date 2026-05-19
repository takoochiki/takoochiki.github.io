// Alias Matter.js modules
const Engine = Matter.Engine,
    Render = Matter.Render,
    Runner = Matter.Runner,
    MouseConstraint = Matter.MouseConstraint,
    Mouse = Matter.Mouse,
    World = Matter.World,
    Bodies = Matter.Bodies,
    Events = Matter.Events;

// ─── Engine Setup ───
const engine = Engine.create();
const world = engine.world;
engine.world.gravity.y = 0.5;

const render = Render.create({
    element: document.body,
    engine: engine,
    options: {
        width: window.innerWidth,
        height: window.innerHeight,
        background: 'transparent',
        wireframes: false,
        showAngleIndicator: false
    }
});
Render.run(render);

const runner = Runner.create();
Runner.run(runner, engine);

// ─── Logo Dimensions ───
const ASPECT_RATIO = 35.01 / 147.29;
const logoWidth = Math.max(Math.min(window.innerWidth * 0.6, 500), 250);
const logoHeight = logoWidth * ASPECT_RATIO;

// ─── Logo Physics Body ───
const logoBody = Bodies.rectangle(
    window.innerWidth / 2,
    window.innerHeight / 2 - 100,
    logoWidth,
    logoHeight,
    {
        chamfer: { radius: logoHeight / 2 },
        restitution: 0.8,
        friction: 0.05,
        frictionAir: 0.015,
        density: 0.005,
        render: { visible: false }
    }
);

// ─── Screen Boundaries ───
let boundaries = [];

function createBoundaries() {
    if (boundaries.length > 0) World.remove(world, boundaries);
    const t = 100, w = window.innerWidth, h = window.innerHeight;
    const opts = { isStatic: true, restitution: 0.9, friction: 0.1, render: { visible: false } };
    boundaries = [
        Bodies.rectangle(w / 2, -t / 2, w + t * 2, t, opts),
        Bodies.rectangle(w / 2, h + t / 2, w + t * 2, t, opts),
        Bodies.rectangle(-t / 2, h / 2, t, h + t * 2, opts),
        Bodies.rectangle(w + t / 2, h / 2, t, h + t * 2, opts)
    ];
    World.add(world, boundaries);
}

createBoundaries();
World.add(world, logoBody);

// ─── Links Collision Body ───
let linksBody = null;

function updateLinksBoundary() {
    if (linksBody) World.remove(world, linksBody);
    const el = document.querySelector('.profile-links');
    if (!el) return;
    const rect = el.getBoundingClientRect();
    linksBody = Bodies.rectangle(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        rect.width,
        rect.height,
        { isStatic: true, restitution: 0.8, friction: 0.1, render: { visible: false } }
    );
    World.add(world, linksBody);
}

document.fonts.ready.then(() => updateLinksBoundary());

// ─── Mouse Constraint ───
const mouse = Mouse.create(render.canvas);
const mouseConstraint = MouseConstraint.create(engine, {
    mouse: mouse,
    constraint: { stiffness: 0.1, render: { visible: false } }
});
World.add(world, mouseConstraint);
render.mouse = mouse;

// ─── Load SVG Image ───
const logoImg = new Image();
logoImg.src = 'tako_logo.svg';

// ─── Arc Bending State (Spring Physics) ───
let currentBend = 0;
let bendVelocity = 0;

// Tunable constants
const BEND_FACTOR = 500;      // Angular velocity → target bend multiplier (needs to be large since angVel is small ~0.01-0.2)
const BEND_STIFFNESS = 0.2;   // Spring stiffness (how fast it chases the target)
const BEND_DAMPING = 0.85;    // Velocity damping per frame (lower = more wobble)
const MAX_BEND = 60;          // Maximum bend in pixels to prevent extreme distortion
const NUM_STRIPS = 40;        // Number of strips for smooth continuous rendering

// ─── Physics Update: Update spring simulation separately from rendering ───
Events.on(engine, 'afterUpdate', function () {
    const angVel = logoBody.angularVelocity;

    // Spring physics for wobbly bend
    const targetBend = angVel * BEND_FACTOR;
    const springForce = (targetBend - currentBend) * BEND_STIFFNESS;
    bendVelocity = (bendVelocity + springForce) * BEND_DAMPING;
    currentBend += bendVelocity;

    // Clamp to prevent extreme visual distortion
    currentBend = Math.max(-MAX_BEND, Math.min(MAX_BEND, currentBend));
});

// ─── Render: Draw bent logo onto the Matter.js canvas ───
Events.on(render, 'afterRender', function () {
    if (!logoImg.complete || logoImg.naturalWidth === 0) return;

    const ctx = render.context;
    const pos = logoBody.position;
    const angle = logoBody.angle;

    // Curvature from bend amount
    // Parabolic arc approximation: y(x) = curvature * x^2 / 2
    // currentBend = max y-offset at the edges (x = ±logoWidth/2)
    const halfW = logoWidth / 2;
    const curvature = (2 * currentBend) / (halfW * halfW);

    const stripW = logoWidth / NUM_STRIPS;
    const srcStripW = logoImg.naturalWidth / NUM_STRIPS;

    ctx.save();
    ctx.translate(pos.x, pos.y);
    ctx.rotate(angle);

    for (let i = 0; i < NUM_STRIPS; i++) {
        // x position of this strip's center relative to logo center
        const x = (i + 0.5) * stripW - halfW;

        // Parabolic arc: y offset and tangent angle
        const yOffset = curvature * x * x / 2;
        const stripAngle = Math.atan(curvature * x);

        ctx.save();
        ctx.translate(x, yOffset);
        ctx.rotate(stripAngle);

        // Draw this strip with slight overlap to prevent sub-pixel gaps
        ctx.drawImage(
            logoImg,
            i * srcStripW, 0, srcStripW + 0.5, logoImg.naturalHeight,
            -stripW / 2 - 0.3, -logoHeight / 2,
            stripW + 0.6, logoHeight
        );

        ctx.restore();
    }

    ctx.restore();
});

// ─── Window Resize ───
window.addEventListener('resize', () => {
    render.canvas.width = window.innerWidth;
    render.canvas.height = window.innerHeight;
    render.options.width = window.innerWidth;
    render.options.height = window.innerHeight;
    createBoundaries();
    updateLinksBoundary();
});
