/**
 * 3D Stacked Poker Chips Renderer
 * Realistic Vegas-style clay composite poker chips with 3D bevels, edge stripes & stack physics.
 */

const CHIP_DENOMINATIONS = [
  { value: 1000, color: '#f39c12', darkColor: '#b9770e', notch: '#ffffff', text: '1K', ring: '#d35400' },
  { value: 500,  color: '#8e44ad', darkColor: '#5b2c6f', notch: '#fd79a8', text: '500', ring: '#a569bd' },
  { value: 100,  color: '#2c3e50', darkColor: '#17202a', notch: '#f39c12', text: '100', ring: '#34495e' },
  { value: 25,   color: '#27ae60', darkColor: '#196f3d', notch: '#f1c40f', text: '25',  ring: '#2ecc71' },
  { value: 5,    color: '#e74c3c', darkColor: '#922b21', notch: '#ffffff', text: '5',   ring: '#ec7063' },
  { value: 1,    color: '#ecf0f1', darkColor: '#bdc3c7', notch: '#2980b9', text: '1',   ring: '#bdc3c7' }
];

/**
 * Returns a high-definition 3D poker chip SVG.
 * @param {object} denom Chip configuration
 * @param {string} size 'normal' | 'small' | 'mini'
 * @returns {string} SVG markup
 */
function getChipSVG(denom, size = 'normal') {
  const isSmall = size === 'small';
  const isMini = size === 'mini';
  const width = isMini ? 18 : (isSmall ? 26 : 36);
  const height = isMini ? 20 : (isSmall ? 28 : 40);

  // Dynamic SVG with metallic radial lighting and 3D cylindrical bottom rim
  return `
    <svg viewBox="0 0 44 48" width="${width}" height="${height}" class="chip-svg" style="display:block;filter:drop-shadow(0 2px 3px rgba(0,0,0,0.45));">
      <defs>
        <radialGradient id="chip-grad-${denom.value}" cx="35%" cy="30%" r="70%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35"/>
          <stop offset="60%" stop-color="#000000" stop-opacity="0.0"/>
          <stop offset="100%" stop-color="#000000" stop-opacity="0.38"/>
        </radialGradient>
      </defs>
      
      <!-- 3D Bottom Cylindrical Extrusion (Thickness Rim) -->
      <path d="M 2 22 A 20 20 0 0 0 42 22 L 42 26 A 20 20 0 0 1 2 26 Z" fill="${denom.darkColor}"/>
      <path d="M 2 22 A 20 20 0 0 0 42 22 L 42 26 A 20 20 0 0 1 2 26 Z" fill="rgba(0,0,0,0.3)"/>
      <path d="M 2 22 A 20 20 0 0 0 42 22 L 42 25 A 20 20 0 0 1 2 25 Z" fill="${denom.darkColor}"/>

      <!-- Main Face Base -->
      <circle cx="22" cy="22" r="20" fill="${denom.color}" stroke="${denom.darkColor}" stroke-width="0.8"/>
      
      <!-- Edge Stripes / Notches (6 Authentic Clay Notches around rim) -->
      <circle cx="22" cy="22" r="17.5" fill="none" stroke="${denom.notch}" stroke-width="5"
              stroke-dasharray="6.6 12.25" stroke-dashoffset="3.3"/>

      <!-- Radial 3D Shading on face -->
      <circle cx="22" cy="22" r="20" fill="url(#chip-grad-${denom.value})"/>

      <!-- Inner Grooved Ring (Classic Casino Inlay Ring) -->
      <circle cx="22" cy="22" r="14.2" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="0.8" stroke-dasharray="1.8 1.8"/>
      <circle cx="22" cy="22" r="13.2" fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="0.7"/>

      <!-- Center Foil Inlay Disc -->
      <circle cx="22" cy="22" r="10" fill="#ffffff" opacity="0.94" stroke="${denom.darkColor}" stroke-width="0.7"/>
      <circle cx="22" cy="22" r="8.8" fill="none" stroke="${denom.color}" stroke-width="0.7"/>

      <!-- Denomination Text -->
      <text x="22" y="${isMini ? '24.5' : '25.2'}" text-anchor="middle" font-size="${denom.value >= 100 ? '7.5' : '8.5'}"
            font-weight="900" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            fill="#111827" letter-spacing="-0.3">${denom.text}</text>
    </svg>
  `;
}

/**
 * Deconstructs an integer amount into an array of chip denomination objects.
 * @param {number} amount
 * @param {number} maxChips
 * @returns {Array<object>}
 */
function breakdownAmountToChips(amount, maxChips = 14) {
  let rem = Math.max(0, parseInt(amount) || 0);
  if (rem === 0) return [];

  const chips = [];
  for (const denom of CHIP_DENOMINATIONS) {
    if (rem <= 0) break;
    const count = Math.floor(rem / denom.value);
    if (count > 0) {
      // Pick up to 4 chips per denomination to keep stacks balanced and aesthetic
      const take = Math.min(count, 4);
      for (let i = 0; i < take; i++) {
        chips.push(denom);
      }
      rem -= take * denom.value;
    }
  }

  // If chips is empty but amount > 0, provide smallest chip
  if (chips.length === 0 && amount > 0) {
    chips.push(CHIP_DENOMINATIONS[CHIP_DENOMINATIONS.length - 1]);
  }

  return chips.slice(0, maxChips);
}

/**
 * Renders a realistic 3D chip stack (or multi-column pile for larger amounts).
 * @param {number} amount
 * @param {string} size 'normal' | 'small'
 * @returns {string} HTML string
 */
function render3DChipStack(amount, size = 'normal') {
  const chips = breakdownAmountToChips(amount, size === 'small' ? 8 : 12);
  if (chips.length === 0) return '';

  const isSmall = size === 'small';
  const chipHeightStep = isSmall ? 4 : 5.5; // pixel vertical offset between chips in stack
  const maxPerCol = isSmall ? 4 : 5;

  // Split into columns if many chips
  const columns = [];
  for (let i = 0; i < chips.length; i += maxPerCol) {
    columns.push(chips.slice(i, i + maxPerCol));
  }

  let html = `<div class="poker-chip-stack-container size-${size}">`;

  columns.forEach((colChips, colIdx) => {
    const colHeight = (colChips.length - 1) * chipHeightStep + (isSmall ? 28 : 40);
    const colWidth = isSmall ? 26 : 36;

    html += `<div class="poker-chip-column" style="height:${colHeight}px; width:${colWidth}px;">`;

    colChips.forEach((chip, chipIdx) => {
      const bottomOffset = chipIdx * chipHeightStep;
      const zIndex = chipIdx + 1;
      html += `
        <div class="poker-chip-layer" style="bottom:${bottomOffset}px; z-index:${zIndex};">
          ${getChipSVG(chip, size)}
        </div>
      `;
    });

    html += `</div>`;
  });

  html += `</div>`;
  return html;
}

/**
 * Returns a small mini-chip indicator for chip counts.
 */
function renderMiniChipStackIcon() {
  const chip = CHIP_DENOMINATIONS[2]; // Black $100 chip
  return `
    <span class="mini-chip-icon" style="display:inline-block;vertical-align:middle;margin-right:3px;">
      ${getChipSVG(chip, 'mini')}
    </span>
  `;
}

// Attach to window
window.render3DChipStack = render3DChipStack;
window.renderMiniChipStackIcon = renderMiniChipStackIcon;
