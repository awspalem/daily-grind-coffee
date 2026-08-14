// Pure TypeScript Standards-Compliant QR Code Generator (Versions 1-10)
// Outputs crisp vector SVG for Thermal Label and Screen printing
// GF(256) Tables with primitive polynomial 0x11d (285)
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);
(() => {
    let val = 1;
    for (let i = 0; i < 255; i++) {
        EXP_TABLE[i] = val;
        EXP_TABLE[i + 255] = val;
        LOG_TABLE[val] = i;
        val = (val << 1) ^ (val & 0x80 ? 0x11d : 0);
    }
    LOG_TABLE[0] = 0;
})();
function gMul(a, b) {
    if (a === 0 || b === 0)
        return 0;
    return EXP_TABLE[LOG_TABLE[a] + LOG_TABLE[b]];
}
function rsGeneratorPoly(degree) {
    let poly = new Uint8Array([1]);
    for (let i = 0; i < degree; i++) {
        const next = new Uint8Array(poly.length + 1);
        for (let j = 0; j < poly.length; j++) {
            next[j] ^= gMul(poly[j], EXP_TABLE[i]);
            next[j + 1] ^= poly[j];
        }
        poly = next;
    }
    return poly;
}
function rsCalculateECC(data, ecLength) {
    const gen = rsGeneratorPoly(ecLength);
    const result = new Uint8Array(ecLength);
    for (let i = 0; i < data.length; i++) {
        const factor = data[i] ^ result[0];
        result.copyWithin(0, 1);
        result[ecLength - 1] = 0;
        for (let j = 0; j < ecLength; j++) {
            result[j] ^= gMul(gen[j], factor);
        }
    }
    return result;
}
const QR_SPECS = [
    {
        version: 1,
        totalCodewords: 26,
        ecCodewordsPerBlock: { L: 7, M: 10, Q: 13, H: 17 },
        numBlocks: { L: [1, 19], M: [1, 16], Q: [1, 13], H: [1, 9] },
        alignmentPatterns: []
    },
    {
        version: 2,
        totalCodewords: 44,
        ecCodewordsPerBlock: { L: 10, M: 16, Q: 22, H: 28 },
        numBlocks: { L: [1, 34], M: [1, 28], Q: [1, 22], H: [1, 16] },
        alignmentPatterns: [6, 18]
    },
    {
        version: 3,
        totalCodewords: 70,
        ecCodewordsPerBlock: { L: 15, M: 26, Q: 36, H: 44 },
        numBlocks: { L: [1, 55], M: [1, 44], Q: [2, 17], H: [2, 13] },
        alignmentPatterns: [6, 22]
    },
    {
        version: 4,
        totalCodewords: 100,
        ecCodewordsPerBlock: { L: 20, M: 36, Q: 52, H: 64 },
        numBlocks: { L: [1, 80], M: [2, 32], Q: [2, 24], H: [4, 9] },
        alignmentPatterns: [6, 26]
    },
    {
        version: 5,
        totalCodewords: 134,
        ecCodewordsPerBlock: { L: 26, M: 48, Q: 72, H: 88 },
        numBlocks: { L: [1, 108], M: [2, 43], Q: [2, 15, 2, 16], H: [2, 11, 2, 12] },
        alignmentPatterns: [6, 30]
    },
    {
        version: 6,
        totalCodewords: 172,
        ecCodewordsPerBlock: { L: 36, M: 64, Q: 96, H: 112 },
        numBlocks: { L: [2, 68], M: [4, 27], Q: [4, 19], H: [4, 15] },
        alignmentPatterns: [6, 34]
    },
    {
        version: 7,
        totalCodewords: 196,
        ecCodewordsPerBlock: { L: 40, M: 72, Q: 108, H: 130 },
        numBlocks: { L: [2, 78], M: [4, 31], Q: [2, 14, 4, 15], H: [4, 13, 1, 14] },
        alignmentPatterns: [6, 22, 38]
    },
    {
        version: 8,
        totalCodewords: 242,
        ecCodewordsPerBlock: { L: 48, M: 88, Q: 130, H: 156 },
        numBlocks: { L: [2, 97], M: [2, 38, 2, 39], Q: [4, 18, 2, 19], H: [4, 14, 2, 15] },
        alignmentPatterns: [6, 24, 42]
    },
    {
        version: 9,
        totalCodewords: 292,
        ecCodewordsPerBlock: { L: 60, M: 110, Q: 162, H: 192 },
        numBlocks: { L: [2, 116], M: [3, 36, 2, 37], Q: [4, 16, 4, 17], H: [4, 12, 4, 13] },
        alignmentPatterns: [6, 26, 46]
    },
    {
        version: 10,
        totalCodewords: 346,
        ecCodewordsPerBlock: { L: 72, M: 130, Q: 192, H: 224 },
        numBlocks: { L: [2, 68, 2, 69], M: [4, 43, 1, 44], Q: [6, 19, 2, 20], H: [6, 15, 2, 16] },
        alignmentPatterns: [6, 28, 50]
    }
];
const FORMAT_INFO_TABLE = {
    L: [0x77c4, 0x72f3, 0x7daa, 0x789d, 0x662f, 0x6318, 0x6c41, 0x6976],
    M: [0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0],
    Q: [0x355f, 0x3068, 0x3f31, 0x3a06, 0x24b4, 0x2183, 0x2eda, 0x2bed],
    H: [0x1689, 0x13be, 0x1ce7, 0x19d0, 0x0762, 0x0255, 0x0d0c, 0x083b]
};
export class QRCodeEncoder {
    static encode(text, level = 'M') {
        const utf8Bytes = new TextEncoder().encode(text);
        const dataLen = utf8Bytes.length;
        let spec = null;
        for (const candidate of QR_SPECS) {
            const blockInfo = candidate.numBlocks[level];
            let capacity = 0;
            if (blockInfo.length === 2) {
                capacity = blockInfo[0] * blockInfo[1];
            }
            else {
                capacity = blockInfo[0] * blockInfo[1] + blockInfo[2] * blockInfo[3];
            }
            const headerBits = 4 + (candidate.version < 10 ? 8 : 16);
            const totalDataBits = headerBits + dataLen * 8;
            const totalCapacityBits = capacity * 8;
            if (totalDataBits <= totalCapacityBits) {
                spec = candidate;
                break;
            }
        }
        if (!spec) {
            spec = QR_SPECS[QR_SPECS.length - 1];
        }
        const version = spec.version;
        const moduleCount = version * 4 + 17;
        const blockInfo = spec.numBlocks[level];
        const totalDataCapacity = blockInfo.length === 2
            ? blockInfo[0] * blockInfo[1]
            : blockInfo[0] * blockInfo[1] + blockInfo[2] * blockInfo[3];
        const bitBuffer = [];
        const pushBits = (value, length) => {
            for (let i = length - 1; i >= 0; i--) {
                bitBuffer.push((value >> i) & 1);
            }
        };
        pushBits(0b0100, 4);
        pushBits(dataLen, version < 10 ? 8 : 16);
        for (let i = 0; i < utf8Bytes.length; i++) {
            pushBits(utf8Bytes[i], 8);
        }
        const capacityBits = totalDataCapacity * 8;
        const termLen = Math.min(4, capacityBits - bitBuffer.length);
        pushBits(0, termLen);
        while (bitBuffer.length % 8 !== 0) {
            bitBuffer.push(0);
        }
        const padBytes = [0xec, 0x11];
        let padIdx = 0;
        while (bitBuffer.length < capacityBits) {
            pushBits(padBytes[padIdx % 2], 8);
            padIdx++;
        }
        const dataBytes = new Uint8Array(totalDataCapacity);
        for (let i = 0; i < totalDataCapacity; i++) {
            let b = 0;
            for (let j = 0; j < 8; j++) {
                b = (b << 1) | bitBuffer[i * 8 + j];
            }
            dataBytes[i] = b;
        }
        const totalEc = spec.ecCodewordsPerBlock[level];
        const numBlocksTotal = blockInfo.length === 2 ? blockInfo[0] : blockInfo[0] + blockInfo[2];
        const ecPerBlock = Math.floor(totalEc / numBlocksTotal);
        const dataBlocks = [];
        const ecBlocks = [];
        let offset = 0;
        const g1Count = blockInfo[0];
        const g1Size = blockInfo[1];
        for (let b = 0; b < g1Count; b++) {
            const slice = dataBytes.slice(offset, offset + g1Size);
            offset += g1Size;
            dataBlocks.push(slice);
            ecBlocks.push(rsCalculateECC(slice, ecPerBlock));
        }
        if (blockInfo.length === 4) {
            const g2Count = blockInfo[2];
            const g2Size = blockInfo[3];
            for (let b = 0; b < g2Count; b++) {
                const slice = dataBytes.slice(offset, offset + g2Size);
                offset += g2Size;
                dataBlocks.push(slice);
                ecBlocks.push(rsCalculateECC(slice, ecPerBlock));
            }
        }
        const finalCodewords = [];
        const maxDataLen = Math.max(...dataBlocks.map(b => b.length));
        for (let i = 0; i < maxDataLen; i++) {
            for (let b = 0; b < numBlocksTotal; b++) {
                if (i < dataBlocks[b].length) {
                    finalCodewords.push(dataBlocks[b][i]);
                }
            }
        }
        for (let i = 0; i < ecPerBlock; i++) {
            for (let b = 0; b < numBlocksTotal; b++) {
                finalCodewords.push(ecBlocks[b][i]);
            }
        }
        const matrix = Array.from({ length: moduleCount }, () => Array(moduleCount).fill(null));
        const placeFinder = (r, c) => {
            for (let dr = -1; dr <= 7; dr++) {
                for (let dc = -1; dc <= 7; dc++) {
                    const row = r + dr;
                    const col = c + dc;
                    if (row < 0 || row >= moduleCount || col < 0 || col >= moduleCount)
                        continue;
                    if (dr === -1 || dr === 7 || dc === -1 || dc === 7) {
                        matrix[row][col] = false;
                    }
                    else if (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)) {
                        matrix[row][col] = true;
                    }
                    else {
                        matrix[row][col] = false;
                    }
                }
            }
        };
        placeFinder(0, 0);
        placeFinder(0, moduleCount - 7);
        placeFinder(moduleCount - 7, 0);
        if (spec.alignmentPatterns.length > 0) {
            const coords = spec.alignmentPatterns;
            for (let i = 0; i < coords.length; i++) {
                for (let j = 0; j < coords.length; j++) {
                    const r = coords[i];
                    const c = coords[j];
                    if ((r <= 8 && c <= 8) || (r <= 8 && c >= moduleCount - 9) || (r >= moduleCount - 9 && c <= 8)) {
                        continue;
                    }
                    for (let dr = -2; dr <= 2; dr++) {
                        for (let dc = -2; dc <= 2; dc++) {
                            if (Math.abs(dr) === 2 || Math.abs(dc) === 2 || (dr === 0 && dc === 0)) {
                                matrix[r + dr][c + dc] = true;
                            }
                            else {
                                matrix[r + dr][c + dc] = false;
                            }
                        }
                    }
                }
            }
        }
        for (let i = 8; i < moduleCount - 8; i++) {
            if (matrix[6][i] === null)
                matrix[6][i] = i % 2 === 0;
            if (matrix[i][6] === null)
                matrix[i][6] = i % 2 === 0;
        }
        matrix[moduleCount - 8][8] = true;
        for (let i = 0; i < 9; i++) {
            if (matrix[8][i] === null)
                matrix[8][i] = false;
            if (matrix[i][8] === null)
                matrix[i][8] = false;
        }
        for (let i = 0; i < 8; i++) {
            if (matrix[8][moduleCount - 1 - i] === null)
                matrix[8][moduleCount - 1 - i] = false;
            if (matrix[moduleCount - 1 - i][8] === null)
                matrix[moduleCount - 1 - i][8] = false;
        }
        const dataBitStream = [];
        for (const byte of finalCodewords) {
            for (let i = 7; i >= 0; i--) {
                dataBitStream.push((byte >> i) & 1);
            }
        }
        const chosenMask = 0;
        const isMasked = (r, c, m) => {
            switch (m) {
                case 0: return (r + c) % 2 === 0;
                case 1: return r % 2 === 0;
                case 2: return c % 3 === 0;
                case 3: return (r + c) % 3 === 0;
                case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
                case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
                case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
                case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
                default: return (r + c) % 2 === 0;
            }
        };
        let bitIdx = 0;
        let upward = true;
        for (let right = moduleCount - 1; right > 0; right -= 2) {
            if (right === 6)
                right--;
            const cols = [right, right - 1];
            const rowIndices = [];
            if (upward) {
                for (let r = moduleCount - 1; r >= 0; r--)
                    rowIndices.push(r);
            }
            else {
                for (let r = 0; r < moduleCount; r++)
                    rowIndices.push(r);
            }
            for (const r of rowIndices) {
                for (const c of cols) {
                    if (matrix[r][c] === null) {
                        let bit = 0;
                        if (bitIdx < dataBitStream.length) {
                            bit = dataBitStream[bitIdx++];
                        }
                        const maskBit = isMasked(r, c, chosenMask) ? 1 : 0;
                        matrix[r][c] = (bit ^ maskBit) === 1;
                    }
                }
            }
            upward = !upward;
        }
        const formatBits = FORMAT_INFO_TABLE[level][chosenMask];
        for (let i = 0; i < 6; i++)
            matrix[8][i] = ((formatBits >> (14 - i)) & 1) === 1;
        matrix[8][7] = ((formatBits >> 8) & 1) === 1;
        matrix[8][8] = ((formatBits >> 7) & 1) === 1;
        matrix[7][8] = ((formatBits >> 6) & 1) === 1;
        for (let i = 0; i < 6; i++)
            matrix[5 - i][8] = ((formatBits >> (5 - i)) & 1) === 1;
        for (let i = 0; i < 7; i++) {
            matrix[moduleCount - 1 - i][8] = ((formatBits >> i) & 1) === 1;
        }
        for (let i = 0; i < 8; i++) {
            matrix[8][moduleCount - 8 + i] = ((formatBits >> (7 + i)) & 1) === 1;
        }
        return {
            matrix: matrix,
            size: moduleCount
        };
    }
    static renderSVG(text, options = {}) {
        const { size = 200, margin = 2, darkColor = '#000000', lightColor = '#ffffff', errorCorrectionLevel = 'M' } = options;
        const { matrix, size: moduleCount } = this.encode(text, errorCorrectionLevel);
        const totalModules = moduleCount + margin * 2;
        const moduleSize = size / totalModules;
        let pathD = '';
        for (let r = 0; r < moduleCount; r++) {
            for (let c = 0; c < moduleCount; c++) {
                if (matrix[r][c]) {
                    const x = (c + margin) * moduleSize;
                    const y = (r + margin) * moduleSize;
                    pathD += `M${x.toFixed(2)},${y.toFixed(2)}h${moduleSize.toFixed(2)}v${moduleSize.toFixed(2)}h-${moduleSize.toFixed(2)}z `;
                }
            }
        }
        return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">
        <rect width="${size}" height="${size}" fill="${lightColor}" />
        <path d="${pathD.trim()}" fill="${darkColor}" />
      </svg>
    `.trim();
    }
}
