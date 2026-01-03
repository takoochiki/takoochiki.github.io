document.addEventListener('DOMContentLoaded', () => {
    const path = document.getElementById('math-curve');
    const width = 800; // Working width for the path
    const startX = 100;
    const startY = 200; // Move up from 200 to 100

    // Parameters for y = x^2 + a * sin(bx)
    // Normalized x (0 to 1) will be used for calculation convenience, then scaled
    const quadraticScale = 0.0002; // Controls the x^2 curvature (makes it dip or rise)
    const sinAmplitude = 4;      // a
    const sinFrequency = 0.001;    // b
    const linearScale = -0.15; // Controls the linear curvature (makes it dip or rise)
    let d = `M ${startX} ${startY}`;

    for (let x = 0; x <= width; x += 10) {
        // Curve formula: y = (x * 0.5)^2 * scale + sin(x * freq) * amp
        // Adjusting to make it look "fluttery" or "distorted" as requested
        // x^2 part (parabola)
        const xOffset = x - 350; // Center parabola? Or start from 0?
        // User asked for "x secondary function" (quadratic) + sine
        // Let's assume a gentle rise or fall
        const yQuad = (xOffset * xOffset) * quadraticScale;
        const yLinear = xOffset * linearScale;
        const ySin = sinAmplitude * Math.sin(xOffset * sinFrequency);

        const y = startY + yQuad + ySin + yLinear;

        d += ` L ${startX + x} ${y}`;
    }

    path.setAttribute('d', d);
});
