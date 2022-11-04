// Helper constants for fixed-point math. TODO: switch to the Fx8 class?
const FP_BITS = 8
const FP_BITS_SQ = FP_BITS * 2
const FP_BITS_3 = FP_BITS * 3
const FP_ONE = 1 << FP_BITS
const FP_ONE_SQ = FP_ONE << FP_BITS
const FP_ONE_MASK = FP_ONE - 1
const FP_ONE_SQ_MASK = FP_ONE_SQ - 1

namespace simpleperf {
    export let isEnabled: boolean = false

    class Counter {
        name: string
        calls: number
        microsAll: number
        microsShallow: number
        started: number

        constructor(name: string) {
            this.name = name
            this.reset()
        }

        reset() {
            this.calls = 0
            this.microsAll = 0
            this.microsShallow = 0
            this.started = 0
        }

        start() {
            if (!isEnabled) return

            stack.push(this)
            ++this.calls
            this.started = control.micros()
        }

        end() {
            if (!isEnabled) return

            // Ignore the sign/higher bits of the elapsed time to avoid
            // glitches when the microsecond timer wraps. (Every ~18minutes.)
            const elapsed = (control.micros() - this.started) & 0x1fffffff
            this.microsAll += elapsed
            this.microsShallow += elapsed
            
            const popped = stack.pop()
            if (popped != this) throw("bad perf stack nesting")

            if (stack.length > 0) {
                stack[stack.length - 1].microsShallow -= elapsed
            }
        }
    }

    const counters: Counter[] = []
    let stack: Counter[] = []
    let startTick: number = 0
    let endTick: number = 0

    export function getCounter(name: string) {
        const counter: Counter = new Counter(name)
        counters.push(counter)
        return counter
    }

    const perfUntraced = getCounter("(untraced)")

    export function enable() {
        stack = []
        for (let i = 0; i < counters.length; ++i) {
            counters[i].reset()
        }   
        startTick = control.micros()
        isEnabled = true
    }

    export function getResultString(exclusive: boolean) {
        let out = ""
        let elapsed = endTick - startTick
        let totalMicros = 0
        perfUntraced.microsShallow = 0
        for (let i = 0; i < counters.length; ++i) {
            totalMicros += counters[i].microsShallow
        }
        perfUntraced.microsShallow = elapsed - totalMicros
        perfUntraced.microsAll = perfUntraced.microsShallow

        if (stack.length) throw("stack not empty")

        out += "Trace results, sorted by " + (exclusive ? "exclusive" : "inclusive") + "%\n\xa0\n"
        out += "Format: excl%/incl% (excl time/incl time, count)\n\xa0\n"
        out += "elapsed time: " + Math.round(elapsed / 1000) + "ms\n"
        out += "traced time: " + Math.round(totalMicros / 1000) + "ms\n\xa0\n"

        if (exclusive) {
            counters.sort((a, b) => b.microsShallow - a.microsShallow)        
        } else {
            counters.sort((a, b) => b.microsAll - a.microsAll)
        }

        for (let i = 0; i < counters.length; ++i) {
            const pctAll = Math.round(100 * counters[i].microsAll / elapsed)
            const pctShallow = Math.round(100 * counters[i].microsShallow / elapsed)
            const shallow = Math.round(counters[i].microsShallow / 1000)
            const all = Math.round(counters[i].microsAll / 1000)
            out += pctShallow + "%/" + pctAll + "% " + counters[i].name + " (" + shallow + "ms/" + all + "ms " + counters[i].calls + "x)\n"
        }
        return out
    }

    export function disableAndShowResults() {
        isEnabled = false
        endTick = control.micros()
        // TODO: this pushScene appears to be necessary to avoid a 021 error (too many objects) on hardware
        game.pushScene()
        game.showLongText(getResultString(true), DialogLayout.Full)
        game.showLongText(getResultString(false), DialogLayout.Full)
        game.popScene()
    }
}

const perfPrepareFrame = simpleperf.getCounter("prepareFrame")
const perfDrawFrame = simpleperf.getCounter("drawFrame")
const perfDrawFrameRead = simpleperf.getCounter("drawFrameRead")
const perfDrawFrameSort = simpleperf.getCounter("drawFrameSort")
const perfDrawFrameBuf = simpleperf.getCounter("drawFrameBuf")
const perfPreRender = simpleperf.getCounter("preRender")
const perfVertexTransform = simpleperf.getCounter("vertexXform")
const perfClipWorld = simpleperf.getCounter("clipWorld")
const perfPerspective = simpleperf.getCounter("perspective")
const perfaddTrapezoids = simpleperf.getCounter("addTrapezoids")
const perfOutTri = simpleperf.getCounter("outTri")
const perfOutTriSimple = simpleperf.getCounter("outTriSimple")
const perfClipPoly = simpleperf.getCounter("clipPoly")
const perfClipEdge = simpleperf.getCounter("clipEdge")

interface Fx16 {
    _dummyFx16: string;
}

namespace Fx {
    export function toIntFloor(a: Fx8) {
        return (a as any as number) >> 8
    }

    export function frac(a: Fx8) {
        return ((a as any as number) & 255) as any as Fx8
    }
    export function frac2(a: Fx8) {
        return ((a as any as number) & 511) as any as Fx8
    }

    export function mul16(a: Fx8, b: Fx8): Fx16 {
        return (Math.imul((a as any as number), (b as any as number))) as any as Fx16
    }

    export function add3(a: Fx16, b: Fx16, c: Fx16): Fx8 {
        return ((a as any as number) + (b as any as number) + (c as any as number) >> 8) as any as Fx8
    }

    export function add4(a: Fx16, b: Fx16, c: Fx16, d: Fx8): Fx8 {
        return (((a as any as number) + (b as any as number) + (c as any as number) >> 8) + (d as any as number)) as any as Fx8
    }

    export function multiplyAdd3(a0: Fx8, b0: Fx8, a1: Fx8, b1: Fx8, a2: Fx8, b2: Fx8): Fx8 {
        return (Math.imul(a0 as any as number, b0 as any as number) +
                Math.imul(a1 as any as number, b1 as any as number) +
                Math.imul(a2 as any as number, b2 as any as number) >> 8) as any as Fx8
    }

    export function multiplyAdd4(a0: Fx8, b0: Fx8, a1: Fx8, b1: Fx8, a2: Fx8, b2: Fx8, c: Fx8): Fx8 {
        return ((Math.imul(a0 as any as number, b0 as any as number) +
                 Math.imul(a1 as any as number, b1 as any as number) +
                 Math.imul(a2 as any as number, b2 as any as number) >> 8) + (c as any as number)) as any as Fx8
    }

}

function Fx8_to_FP(a: Fx8) {
    // assumes FP_BITS is 8
    return (a as any as number)
}

function FP_to_Fx8(a: number): Fx8 {
    // assumes FP_BITS is 8
    return (a as any as number) as any as Fx8
}

namespace renderer3d {
    /*
    export function drawTriLineAlternatingSwapped(tri: ActiveTrapezoid, buf: Buffer, col0: number, col1: number) {
        renderer3d.drawTriLineAlternating(tri, buf, col1, col0)
    }

    export function drawTriLineFlatCol1(tri: ActiveTrapezoid, buf: Buffer, col0: number, col1: number) {
        renderer3d.drawTriLineFlat(tri, buf, col1)
    }
    */

    export function drawTriLineAlternating(tri: ActiveTrapezoid, buf: Buffer, col0: number, col1: number) {
        const y0 = Fx.toIntFloor(tri.a_y)
        const y1 = Fx.toIntFloor(tri.b_y)

        let y = y0
        if (y & 1) {
            // Swap the colors so that col0 is consistently on even Y
            const tmp = col0
            col0 = col1
            col1 = tmp
        }

        let y1end = y1 - 7
        while (y <= y1end) {
            buf.setUint8(y, col0)
            buf.setUint8(y + 1, col1)
            buf.setUint8(y + 2, col0)
            buf.setUint8(y + 3, col1)
            buf.setUint8(y + 4, col0)
            buf.setUint8(y + 5, col1)
            buf.setUint8(y + 6, col0)
            buf.setUint8(y + 7, col1)
            y += 8
        }
        if (y <= y1 - 3) {
            buf.setUint8(y, col0)
            buf.setUint8(y + 1, col1)
            buf.setUint8(y + 2, col0)
            buf.setUint8(y + 3, col1)
            y += 4
        }
        if (y <= y1 - 1) {
            buf.setUint8(y, col0)
            buf.setUint8(y + 1, col1)
            y += 2
        }
        if (y <= y1) {
            buf.setUint8(y, col0)
            //++y
        }
        tri.a_y = Fx.add(tri.a_y, tri.a_dydx)
        tri.b_y = Fx.add(tri.b_y, tri.b_dydx)
    }

    export function drawTriLineFlat(tri: ActiveTrapezoid, buf: Buffer, col: number) {
        //console.log("x=" + x + " tri.x0=" + tri.x0 + " tri.z=" + tri.z)
        const y0 = Fx.toIntFloor(tri.a_y)
        const y1 = Fx.toIntFloor(tri.b_y)

        let y = y0
        let y1end = y1 - 7
        while (y <= y1end) {
            buf.setUint8(y, col)
            buf.setUint8(y + 1, col)
            buf.setUint8(y + 2, col)
            buf.setUint8(y + 3, col)
            buf.setUint8(y + 4, col)
            buf.setUint8(y + 5, col)
            buf.setUint8(y + 6, col)
            buf.setUint8(y + 7, col)
            y += 8
        }
        if (y <= y1 - 3) {
            buf.setUint8(y, col)
            buf.setUint8(y + 1, col)
            buf.setUint8(y + 2, col)
            buf.setUint8(y + 3, col)
            y += 4
        }
        if (y <= y1 - 1) {
            buf.setUint8(y, col)
            buf.setUint8(y + 1, col)
            y += 2
        }
        if (y <= y1) {
            buf.setUint8(y, col)
            //++y
        }
        tri.a_y = Fx.add(tri.a_y, tri.a_dydx)
        tri.b_y = Fx.add(tri.b_y, tri.b_dydx)
    }
}

class Renderer3d {
   // Storage for the Drawables, indexed by starting X coordinate
    xstarts: Trapezoid[][]
    columnBuffer: Buffer
    lightDirection: number[]
    viewerFromWorld: number[]

    _nextOrderNum: number

    // Configurable settings
    useFlatShading: boolean

    // dither pattern:
    //   0 3
    //   2 1
    //static dither0 = [0, 2]
    //static dither1 = [3, 1]
    /*
    // The indirect function call seems to be slower than conditionals
    static ditherEven = [
        renderer3d.drawTriLineFlat,
        renderer3d.drawTriLineAlternating,
        renderer3d.drawTriLineAlternating,
        renderer3d.drawTriLineAlternating]

    static ditherOdd = [
        renderer3d.drawTriLineFlat,
        renderer3d.drawTriLineFlat,
        renderer3d.drawTriLineAlternatingSwapped,
        renderer3d.drawTriLineFlatCol1]
    */
    constructor() {
        this.xstarts = []
        this.columnBuffer = Buffer.create(120)
        this.useFlatShading = true
        this.lightDirection = [0, 0, -1]
        this.viewerFromWorld = []
    }

    setPaletteGrayscale() {
        const p = palette.defaultPalette();
        for (let i = 0; i < p.length; ++i) {
            p.setColor(i, color.rgb(i * 16, i * 16, i * 16));
        }
        p.setColor(0, 0)
        //p.setColor(1, color.rgb(255, 0, 0))
        palette.setColors(p)
    }

    setPaletteDefault() {
        const p = palette.defaultPalette();
        p.setColor(0, 0)
        palette.setColors(p)
    }

    setLightAngles(alphaDegrees: number, betaDegrees: number) {
        const alpha = alphaDegrees * Math.PI / 180
        const beta = betaDegrees * Math.PI / 180
        
        this.lightDirection[0] = Math.floor(Math.cos(alpha) * Math.cos(beta) * FP_ONE)
        this.lightDirection[1] = Math.floor(Math.sin(beta) * FP_ONE)
        this.lightDirection[2] = Math.floor(Math.sin(alpha) * Math.cos(beta) * FP_ONE)
        //normalizeFP(lightDirection) - not needed, already normalized
    }

    setViewerPose(poseMatrix: number[]) {
        setInverseTransformFP_from_Float(this.viewerFromWorld, poseMatrix)
    }

    prepareFrame() {
        perfPrepareFrame.start()
        Trapezoid.resetInstances()
        if (!this.xstarts.length) {
            for (let x = 0; x < 160; ++x) {
                this.xstarts[x] = []
            }
        }
        this._nextOrderNum = 1
        perfPrepareFrame.end()
    }

    getOrderNum() {
        return this._nextOrderNum++
    }

    freeResources() {
        Trapezoid.eraseInstances()
        this.xstarts = []
    }

    drawFrame(image: Image) {
        perfDrawFrame.start()
        //control.enablePerfCounter()
        //console.logValue("trapezoids", Trapezoid.instNum)

        const buf = this.columnBuffer

        const xstarts = this.xstarts
        if (!xstarts.length) {
            perfDrawFrame.end()
            return
        }
        //ActiveTrapezoid.resetInstances()
        let active: ActiveTrapezoid[] = []
        let activeOut: ActiveTrapezoid[] = []
        let nextEnd = 999

        for (let x = 0; x < 160; ++x) {

            perfDrawFrameSort.start()
            // Update the active trapezoid list. Need to remove the ones that
            // have passed their end coordinate (x1), and add new ones from xstarts.
            if (x >= nextEnd || xstarts[x].length) {
                //console.log("x=" + x + " **********************")
                nextEnd = 999
                const toMerge: Trapezoid[] = xstarts[x]
                //console.log("  active=" + active.map(v => "o=" + v.base.order + ",x1=" + v.base.x1).join(", "))
                //console.log("  toMerge=" + toMerge.map(v => "o=" + v.order + ",x1=" + v.x1).join(", "))

                // Do a merge sort, combining the already-sorted active array with the new entries.
                let j = 0 // output index
                if (toMerge.length) {
                    // sort the xstarts that need merging in ascending order
                    toMerge.sort((a, b) => a.order - b.order)
                    let aidx = 0 // for the active array
                    let midx = 0 // for the toMerge array

                    // While both arrays have elements, take the smaller then check again.
                    while (aidx < active.length && midx < toMerge.length) {
                        if (active[aidx].base.x1 < x) {
                            // This one is past its end, skip it
                            ++aidx
                        } else {
                            let v: ActiveTrapezoid
                            if (active[aidx].base.order < toMerge[midx].order) {
                                v = active[aidx++]
                            } else {
                                v = new ActiveTrapezoid(toMerge[midx++])
                            }
                            const vx1 = v.base.x1
                            if (vx1 < nextEnd) nextEnd = vx1
                            activeOut[j++] = v
                        }
                    }
                    // Copy whichever array has leftovers (should be only one of them)
                    while (aidx < active.length) {
                        const v = active[aidx++]
                        const vx1 = v.base.x1
                        if (vx1 < x) continue
                        if (vx1 < nextEnd) nextEnd = vx1
                        activeOut[j++] = v
                    }
                    while (midx < toMerge.length) {
                        const v = new ActiveTrapezoid(toMerge[midx++])
                        const vx1 = v.base.x1
                        if (vx1 < nextEnd) nextEnd = vx1
                        activeOut[j++] = v
                    }
                    xstarts[x] = []
                } else {
                    // Nothing to merge. Just delete trapezoids that have passed the end.
                    for (let i = 0; i < active.length; ++i) {
                        const v = active[i]
                        const vx1 = v.base.x1
                        if (vx1 < x) continue
                        if (vx1 < nextEnd) nextEnd = vx1
                        activeOut[j++] = v
                    }
                }
                //console.log("x=" + x + " nextEnd=" + nextEnd + " activeOut=" + activeOut.map(v => "ord=" + v.base.order + " x1=" + v.base.x1).join(", "))
                // Delete any leftover entries in activeOut that weren't overwritten.
                activeOut.splice(j, activeOut.length)
                // Swap the arrays for next time
                const tmp = active
                active = activeOut
                activeOut = tmp
            }

            /*
            active = active.filter(v => v.base.x1 >= x)
            if (xstarts[x].length) {
                while (xstarts[x].length) {
                    let d : Drawable = xstarts[x].pop()
                    active.push(new ActiveTrapezoid(d as Trapezoid))
                }
                // Sort in ascending priority order, drawing lower numbers first.
                // This isn't necessarily a Z value. When using a strict painter's algorithm,
                // this is simply the object's sequence number.
                active.sort((a, b) => a.base.order - b.base.order)
            }
            */
            perfDrawFrameSort.end()

            if (!active.length) continue

            perfDrawFrameRead.start()
            image.getRows(x, buf)
            perfDrawFrameRead.end()

            //const dither = x & 1 ? Renderer3d.dither1 : Renderer3d.dither0
            //const dither = x & 1 ? Renderer3d.ditherOdd : Renderer3d.ditherEven

            perfDrawFrameBuf.start()
            if (this.useFlatShading) {
                for (let l = 0; l < active.length; ++l) {
                    const tri = active[l]
                    renderer3d.drawTriLineFlat(tri, buf, tri.base.color >> 2)
                }
            } else {
                /*
                for (let l = 0; l < active.length; ++l) {
                    let tri = active[l]
                    //console.log("x=" + x + " tri.x0=" + tri.x0 + " tri.z=" + tri.z)
                    const colBase = tri.base.color
                    const col0 = colBase >> 2
                    const col1 = col0 + 1
                    const colIncr = colBase & 3
                    dither[colIncr](tri, buf, col0, col1)
                }
                */
                if (x & 1) {
                    for (let l = 0; l < active.length; ++l) {
                        let tri = active[l]
                        //console.log("x=" + x + " tri.x0=" + tri.x0 + " tri.z=" + tri.z)
                        const colBase = tri.base.color
                        const col0 = colBase >> 2
                        const col1 = col0 + 1
                        const colIncr = colBase & 3
                        if (colIncr <= 1) {
                            renderer3d.drawTriLineFlat(tri, buf, col0)
                        } else if (colIncr == 3) {
                            renderer3d.drawTriLineFlat(tri, buf, col1)
                        } else { //if (colIncr == 2) 
                            renderer3d.drawTriLineAlternating(tri, buf, col1, col0)
                        }
                    }
                } else {
                    for (let l = 0; l < active.length; ++l) {
                        let tri = active[l]
                        //console.log("x=" + x + " tri.x0=" + tri.x0 + " tri.z=" + tri.z)
                        const colBase = tri.base.color
                        const col0 = colBase >> 2
                        const colIncr = colBase & 3
                        if (colIncr == 0) {
                            renderer3d.drawTriLineFlat(tri, buf, col0)
                        } else {
                            const col1 = col0 + 1
                            renderer3d.drawTriLineAlternating(tri, buf, col0, col1)
                        }
                    }
                }
                /*
                for (let l = 0; l < active.length; ++l) {
                    let tri = active[l]
                    //console.log("x=" + x + " tri.x0=" + tri.x0 + " tri.z=" + tri.z)
                    const colBase = tri.base.color
                    const col0 = colBase >> 2
                    const col1 = col0 + 1
                    const colIncr = colBase & 3
                    if (xbit) {
                        if (colIncr <= 1) {
                            Renderer3d.drawTriLineFlat(tri, buf, col0)
                        } else if (colIncr == 3) {
                            Renderer3d.drawTriLineFlat(tri, buf, col1)
                        } else { //if (colIncr == 2) 
                            Renderer3d.drawTriLineAlternating(tri, buf, col1, col0)
                        }
                    } else {
                        if (colIncr == 0) {
                            Renderer3d.drawTriLineFlat(tri, buf, col0)
                        } else {
                            Renderer3d.drawTriLineAlternating(tri, buf, col0, col1)
                        }
                    }
                }
                */
                    /*
                    const col = tri.base.color
                    let ybit = y0 & 1
                    const y0 = Fx.toIntFloor(tri.a_y)
                    const y1 = Fx.toIntFloor(tri.b_y)
                    for (let y = y0; y <= y1; ++y) {
                        // Sanity check that color values are integers. Don't keep this enabled
                        // when deploying on hardware, it slows things down a lot.
                        //if (col < 0 || col > 63 || col != Math.floor(col)) console.log("col=" + col)
                        buf.setUint8(y, col + dither[ybit] >> 2)
                        ybit = 1 - ybit
                    }
                    tri.a_y = Fx.add(tri.a_y, tri.a_dydx)
                    tri.b_y = Fx.add(tri.b_y, tri.b_dydx)
                    */
            }
            image.setRows(x, buf)
            perfDrawFrameBuf.end()
        }    
        perfDrawFrame.end()
    }
}

// Matrices are 3 rows x 4 columns, following OpenGL conventions but 
// omitting the fourth row which is always (0, 0, 0, 1).
// 
//    m0 m3 m6 m9
//    m1 m4 m7 m10
//    m2 m5 m8 m11
//
// This is stored as a plain array in column-major order:
//   [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9, m10, m11] 
//
// Geometrically, this combines a rotation and position. 
// Space B's origin in space A coordinates is at (ax, ay, az).
// Space B's X axis is in direction (ux, uy, uz) in space A coordinates.
// Space B's Y axis is in direction (vx, vy, vz) in space A coordinates.
// Space B's Z axis is in direction (wx, wy, wz) in space A coordinates.
//
// This matrix product transforms a point in space B coordinates (bx, by, bz)
// to space A coordinates (ax, ay, az):
//
//    ux vx wx px  *  bx  =  ax  = ux*bx + vx*by + wx*bz + ax
//    uy vy wy py     by     ay    uy*bx + vy*by + wy*bz + ay
//    uz vz wz pz     bz     az    uz*bx + vz*by + wz*bz + az
//                     1      1    1

function setInverseTransformFP_from_Float(o: number[], m: number[]) {
    // Inverse of a rotation + translation matrix, converted to fixed point.
    // Transpose the translation part, and apply the transposed (inverse)
    // rotation to the original translation followed by negating it.
    o[0] = Math.floor(m[0] * FP_ONE)
    o[1] = Math.floor(m[3] * FP_ONE)
    o[2] = Math.floor(m[6] * FP_ONE)
    o[3] = Math.floor(m[1] * FP_ONE)
    o[4] = Math.floor(m[4] * FP_ONE)
    o[5] = Math.floor(m[7] * FP_ONE)
    o[6] = Math.floor(m[2] * FP_ONE)
    o[7] = Math.floor(m[5] * FP_ONE)
    o[8] = Math.floor(m[8] * FP_ONE)
    o[9] = Math.floor(-o[0] * m[9] - o[3] * m[10] - o[6] * m[11])
    o[10] = Math.floor(-o[1] * m[9] - o[4] * m[10] - o[7] * m[11])
    o[11] = Math.floor(-o[2] * m[9] - o[5] * m[10] - o[8] * m[11])
    //console.log('m=' + m.join(' '))
    //console.log('o=' + o.join(' '))
}

function vec_applyInverseTransformToOriginFP(out: number[], m: number[]) {
    out[0] = (-m[0] * m[9] - m[1] * m[10] - m[2] * m[11]) >> FP_BITS
    out[1] = (-m[3] * m[9] - m[4] * m[10] - m[5] * m[11]) >> FP_BITS
    out[2] = (-m[6] * m[9] - m[7] * m[10] - m[8] * m[11]) >> FP_BITS
}

function vec_convert_to_FP(out: number[], v: number[]) {
    out[0] = Math.floor(v[0] * FP_ONE)
    out[1] = Math.floor(v[1] * FP_ONE)
    out[2] = Math.floor(v[2] * FP_ONE)
}

function vec_convert_to_Fx8(out: Fx8[], v: number[]) {
    out[0] = Fx8(v[0])
    out[1] = Fx8(v[1])
    out[2] = Fx8(v[2])
}

function normalizeFP(v: number[]) {
    let len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
    v[0] = Math.floor(v[0] * FP_ONE / len)
    v[1] = Math.floor(v[1] * FP_ONE / len)
    v[2] = Math.floor(v[2] * FP_ONE / len)
}

function dot_FP(aFP: number[], bFP: number[]) {
    const a = (aFP as any as Fx8[])
    const b = (bFP as any as Fx8[])

    /*
    return Math.imul(a[0], b[0]) + Math.imul(a[1], b[1]) + Math.imul(a[2], b[2]) >> FP_BITS
    */

    return Fx8_to_FP(Fx.multiplyAdd3(a[0], b[0], a[1], b[1], a[2], b[2]))
}

function mat_setIdentity_FP(m: number[]) {
    m[0] = m[4] = m[8] = FP_ONE
    m[1] = m[2] = m[3] = 0
    m[5] = m[6] = m[7] = 0
    m[9] = m[10] = m[11] = 0
}

function mat33_copy(out: number[], m: number[]) {
    out[0] = m[0]
    out[1] = m[1]
    out[2] = m[2]
    out[3] = m[3]
    out[4] = m[4]
    out[5] = m[5]
    out[6] = m[6]
    out[7] = m[7]
    out[8] = m[8]
}

// Multiply two 3D rotation matrices, leaving the non-rotation parts unchanged
function mul_mat33_mat33_partial_FP(outFP: number[], aFP: number[], bFP: number[]) {
    /*
    out[0] = (a[0] * b[0] + a[3] * b[1] + a[6] * b[2] >> FP_BITS)
    out[1] = (a[1] * b[0] + a[4] * b[1] + a[7] * b[2] >> FP_BITS)
    out[2] = (a[2] * b[0] + a[5] * b[1] + a[8] * b[2] >> FP_BITS)
    out[3] = (a[0] * b[3] + a[3] * b[4] + a[6] * b[5] >> FP_BITS)
    out[4] = (a[1] * b[3] + a[4] * b[4] + a[7] * b[5] >> FP_BITS)
    out[5] = (a[2] * b[3] + a[5] * b[4] + a[8] * b[5] >> FP_BITS)
    out[6] = (a[0] * b[6] + a[3] * b[7] + a[6] * b[8] >> FP_BITS)
    out[7] = (a[1] * b[6] + a[4] * b[7] + a[7] * b[8] >> FP_BITS)
    out[8] = (a[2] * b[6] + a[5] * b[7] + a[8] * b[8] >> FP_BITS)
    */
    const out = (outFP as any as Fx8[])
    const a = (aFP as any as Fx8[])
    const b = (bFP as any as Fx8[])

    out[0] = Fx.multiplyAdd3(a[0], b[0], a[3], b[1], a[6], b[2])
    out[1] = Fx.multiplyAdd3(a[1], b[0], a[4], b[1], a[7], b[2])
    out[2] = Fx.multiplyAdd3(a[2], b[0], a[5], b[1], a[8], b[2])
    out[3] = Fx.multiplyAdd3(a[0], b[3], a[3], b[4], a[6], b[5])
    out[4] = Fx.multiplyAdd3(a[1], b[3], a[4], b[4], a[7], b[5])
    out[5] = Fx.multiplyAdd3(a[2], b[3], a[5], b[4], a[8], b[5])
    out[6] = Fx.multiplyAdd3(a[0], b[6], a[3], b[7], a[6], b[8])
    out[7] = Fx.multiplyAdd3(a[1], b[6], a[4], b[7], a[7], b[8])
    out[8] = Fx.multiplyAdd3(a[2], b[6], a[5], b[7], a[8], b[8])

    /*
    out[1] = Fx.add3(Fx.mul16(a[1], b[0]), Fx.mul16(a[4], b[1]), Fx.mul16(a[7], b[2]))
    out[2] = Fx.add3(Fx.mul16(a[2], b[0]), Fx.mul16(a[5], b[1]), Fx.mul16(a[8], b[2]))
    out[3] = Fx.add3(Fx.mul16(a[0], b[3]), Fx.mul16(a[3], b[4]), Fx.mul16(a[6], b[5]))
    out[4] = Fx.add3(Fx.mul16(a[1], b[3]), Fx.mul16(a[4], b[4]), Fx.mul16(a[7], b[5]))
    out[5] = Fx.add3(Fx.mul16(a[2], b[3]), Fx.mul16(a[5], b[4]), Fx.mul16(a[8], b[5]))
    out[6] = Fx.add3(Fx.mul16(a[0], b[6]), Fx.mul16(a[3], b[7]), Fx.mul16(a[6], b[8]))
    out[7] = Fx.add3(Fx.mul16(a[1], b[6]), Fx.mul16(a[4], b[7]), Fx.mul16(a[7], b[8]))
    out[8] = Fx.add3(Fx.mul16(a[2], b[6]), Fx.mul16(a[5], b[7]), Fx.mul16(a[8], b[8]))
    */
}

function mul_mat33_mat33_full_FP(out: number[], a: number[], b: number[]) {
    mul_mat33_mat33_partial_FP(out, a, b)
    out[9] = out[10] = out[11] = 0
}

function mul_mat43_mat43_FP(outFP: number[], aFP: number[], bFP: number[]) {
    mul_mat33_mat33_partial_FP(outFP, aFP, bFP)

    /*
    out[9] = (a[0] * b[9] + a[3] * b[10] + a[6] * b[11] >> FP_BITS) + a[9]
    out[10] = (a[1] * b[9] + a[4] * b[10] + a[7] * b[11] >> FP_BITS) + a[10]
    out[11] = (a[2] * b[9] + a[5] * b[10] + a[8] * b[11] >> FP_BITS) + a[11]
    */

    const out = (outFP as any as Fx8[])
    const a = (aFP as any as Fx8[])
    const b = (bFP as any as Fx8[])
    out[ 9] = Fx.multiplyAdd4(a[0], b[9], a[3], b[10], a[6], b[11], a[ 9])
    out[10] = Fx.multiplyAdd4(a[1], b[9], a[4], b[10], a[7], b[11], a[10])
    out[11] = Fx.multiplyAdd4(a[2], b[9], a[5], b[10], a[8], b[11], a[11])
}

// Apply rotation and translation
function mul_mat43_vec_FP(outFP: number[], mFP: number[], vFP: number[]) {
    const out = (outFP as any as Fx8[])
    const m = (mFP as any as Fx8[])
    const v = (vFP as any as Fx8[])

    /*
    out[0] = (Math.imul(m[0], v[0]) + Math.imul(m[3], v[1]) + Math.imul(m[6], v[2]) >> FP_BITS) + m[9]
    out[1] = (Math.imul(m[1], v[0]) + Math.imul(m[4], v[1]) + Math.imul(m[7], v[2]) >> FP_BITS) + m[10]
    out[2] = (Math.imul(m[2], v[0]) + Math.imul(m[5], v[1]) + Math.imul(m[8], v[2]) >> FP_BITS) + m[11]
    */
    out[0] = Fx.multiplyAdd4(m[0], v[0], m[3], v[1], m[6], v[2], m[ 9])
    out[1] = Fx.multiplyAdd4(m[1], v[0], m[4], v[1], m[7], v[2], m[10])
    out[2] = Fx.multiplyAdd4(m[2], v[0], m[5], v[1], m[8], v[2], m[11])
}

// Apply rotation only, intended for normal vectors
function mul_mat33_vec_FP(outFP: number[], mFP: number[], vFP: number[]) {
    const out = (outFP as any as Fx8[])
    const m = (mFP as any as Fx8[])
    const v = (vFP as any as Fx8[])

    /*
    out[0] = (Math.imul(m[0], v[0]) + Math.imul(m[3], v[1]) + Math.imul(m[6], v[2]) >> FP_BITS)
    out[1] = (Math.imul(m[1], v[0]) + Math.imul(m[4], v[1]) + Math.imul(m[7], v[2]) >> FP_BITS)
    out[2] = (Math.imul(m[2], v[0]) + Math.imul(m[5], v[1]) + Math.imul(m[8], v[2]) >> FP_BITS)
    */

    out[0] = Fx.multiplyAdd3(m[0], v[0], m[3], v[1], m[6], v[2])
    out[1] = Fx.multiplyAdd3(m[1], v[0], m[4], v[1], m[7], v[2])
    out[2] = Fx.multiplyAdd3(m[2], v[0], m[5], v[1], m[8], v[2])
}

namespace Fx {
    // For background on the sine approximation, see:
    //   https://github.com/microsoft/pxt-common-packages/pull/1178/files
    const sineConstMul = 1 << 15
    const sineApproxC = Math.round(0.0721435357258 * sineConstMul)
    const sineApproxB = Math.round(-0.642443736562 * sineConstMul)
    const sineApproxA = Math.round(1.57030020084 * sineConstMul)
    export function sinFx8(angleTwos: Fx8): Fx8 {
        const phase = (angleTwos as any as number) & 511
        const isSecondHalf = phase & 256
        let p = isSecondHalf ? phase - 256 : phase
        if (p > 128) p = 256 - p

        // Calculate using y = ((c * x^2 + b) * x^2 + a) * x
        //
        // The position p is x * 128, so after each multiply with p we need to
        // shift right by 7 bits to keep the decimal point in the same place.  (The
        // approximation has a negative error near x=1 which helps avoid overflow.)
        const p2 = Math.imul(p, p)
        //if (Math.abs(Math.imul(sineApproxC, p2) + 0x6000) >= 0x40000000) throw("too big")
        const u = (Math.imul(sineApproxC, p2) + 0x6000 >> 14) + sineApproxB
        //if (Math.abs(Math.imul(u, p2) + 0x6000) >= 0x40000000) throw("too big")
        const v = (Math.imul(u, p2) + 0x6000 >> 14) + sineApproxA
        //if (Math.abs(Math.imul(v, p) + 0x2000) >= 0x40000000) throw("too big")
        const w = Math.imul(v, p) + 0x2000 >> 14
        // The result is exact within the 8-bit Fx8 precision.
        return (isSecondHalf ? -w : w) as any as Fx8
    }

    export function cosFx8(angleTwos: Fx8) {
        return sinFx8(((angleTwos as any as number) + 128) as any as Fx8)
    }

    /*
    for (let i = 0; i <= 128; ++i) {
        const v = sinFx8(i as any as Fx8) as any as number
        const s = Math.round(256 * Math.sin(i * Math.PI / 256))
        console.log("sinFx8(" + i + ")=" + sinFx8(i as any as Fx8) + " sin=" + s + " error=" + (v - s))
    }

    console.log("sin(45)=" + Fx.toFloat(sinFx8(64 as any as Fx8)))
    console.log("cos(45)=" + Fx.toFloat(cosFx8(64 as any as Fx8)))
    console.log("sin(90)=" + Fx.toFloat(sinFx8(128 as any as Fx8)))
    console.log("cos(90)=" + Fx.toFloat(cosFx8(128 as any as Fx8)))
    console.log("sin(0)=" + Fx.toFloat(sinFx8(0 as any as Fx8)))
    console.log("cos(0)=" + Fx.toFloat(cosFx8(0 as any as Fx8)))
    throw("stop")
    */
}

// Sets the 3x3 submatrix of the destination matrix to the product of a second
// matrix and a rotation angle. Leaves the positions in the destination
// matrix unchanged.
function mul_mat33_rotate33_columns_FP(out: number[], m: number[], angleTwos: Fx8, a: number, b: number, other: number) {
    let s = Fx8_to_FP(Fx.sinFx8(angleTwos))
    let c = Fx8_to_FP(Fx.cosFx8(angleTwos))
    out[a] = Math.imul(m[a], c) + Math.imul(m[b], s) >> FP_BITS
    out[a + 1] = Math.imul(m[a + 1], c) + Math.imul(m[b + 1], s) >> FP_BITS
    out[a + 2] = Math.imul(m[a + 2], c) + Math.imul(m[b + 2], s) >> FP_BITS
    out[b] = Math.imul(m[b], c) - Math.imul(m[a], s) >> FP_BITS
    out[b + 1] = Math.imul(m[b + 1], c) - Math.imul(m[a + 1], s) >> FP_BITS
    out[b + 2] = Math.imul(m[b + 2], c) - Math.imul(m[a + 2], s) >> FP_BITS
    out[other] = m[other]
    out[other + 1] = m[other + 1]
    out[other + 2] = m[other + 2]
}
function mul_mat33_rotateX_partial_FP(out: number[], m: number[], angleTwos: Fx8) {
    mul_mat33_rotate33_columns_FP(out, m, angleTwos, 3, 6, 0)
}
function mul_mat33_rotateY_partial_FP(out: number[], m: number[], angleTwos: Fx8) {
    mul_mat33_rotate33_columns_FP(out, m, angleTwos, 6, 0, 3)
}
function mul_mat33_rotateZ_partial_FP(out: number[], m: number[], angleTwos: Fx8) {
    mul_mat33_rotate33_columns_FP(out, m, angleTwos, 0, 3, 6)
}

// Apply a rotation in place to the specified matrix.
function rotate_mat33_columns_FP(m: number[], angleTwos: Fx8, a: number, b: number) {
    let s = Fx8_to_FP(Fx.sinFx8(angleTwos))
    let c = Fx8_to_FP(Fx.cosFx8(angleTwos))
    let ox = m[a]
    let oy = m[a + 1]
    let oz = m[a + 2]
    m[a] = Math.imul(m[a], c) + Math.imul(m[b], s) >> FP_BITS
    m[a + 1] = Math.imul(m[a + 1], c) + Math.imul(m[b + 1], s) >> FP_BITS
    m[a + 2] = Math.imul(m[a + 2], c) + Math.imul(m[b + 2], s) >> FP_BITS
    m[b] = Math.imul(m[b], c) - Math.imul(ox, s) >> FP_BITS
    m[b + 1] = Math.imul(m[b + 1], c) - Math.imul(oy, s) >> FP_BITS
    m[b + 2] = Math.imul(m[b + 2], c) - Math.imul(oz, s) >> FP_BITS
}
function rotateX_mat33_FP(m: number[], angleTwos: Fx8) {
    rotate_mat33_columns_FP(m, angleTwos, 3, 6)
}
function rotateY_mat33_FP(m: number[], angleTwos: Fx8) {
    rotate_mat33_columns_FP(m, angleTwos, 6, 0)
}
function rotateZ_mat33_FP(m: number[], angleTwos: Fx8) {
    rotate_mat33_columns_FP(m, angleTwos, 0, 3)
}

function applyScale_FP(m: number[], sx: number, sy: number, sz: number) {
    m[0] = Math.imul(m[0], sx) >> FP_BITS
    m[1] = Math.imul(m[1], sx) >> FP_BITS
    m[2] = Math.imul(m[2], sx) >> FP_BITS
    m[3] = Math.imul(m[3], sy) >> FP_BITS
    m[4] = Math.imul(m[4], sy) >> FP_BITS
    m[5] = Math.imul(m[5], sy) >> FP_BITS
    m[6] = Math.imul(m[6], sz) >> FP_BITS
    m[7] = Math.imul(m[7], sz) >> FP_BITS
    m[8] = Math.imul(m[8], sz) >> FP_BITS
}

function scale_by_fraction(x: number, a: number, b: number) {
    //return Math.idiv(Math.imul(x << 8, a | 0), b | 0) >> 8
    return Fx.toIntFloor(Fx.idiv(Fx.imul(Fx8(x), a), b))
}

interface Drawable {
}

// Rendering is based on trapezoids that are screen-space slices of triangles or other 
// polygons. Each is a quadrilateral with vertical left and right sides, while the top 
// and bottom sides can be at any angle. Any triangle can be represented by at most
// two of these trapezoids, usually with two corners collapsed into a single location
// unless it's clipped at a screen edge.
//
// Examples trapezoids A, B, C:
//
//    +-----____                ___+-_
//    |         |       ____----   |  -_
//    |    A    |      +___    B   |    -_
//    |   ___---+          ----____|  C   -_
//    +---                          ----____=
//
class Trapezoid implements Drawable {
    buf: Buffer
    /*
    x0: number
    y0a: number
    y0b: number
    x1: number
    y1a: number
    y1b: number
    color: number
    order: number
    */

    static instances: Trapezoid[] = []
    static instNum: number = 0

    static addInstance(x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number, col: number, z: number = 0): Trapezoid {
        if (Trapezoid.instNum < Trapezoid.instances.length) {
            const ret = Trapezoid.instances[Trapezoid.instNum]
            ret.set(x0, y0a, y0b, x1, y1a, y1b, col, z)
            //console.log("reuse trapezoid " + Trapezoid.instNum)
            ++Trapezoid.instNum
            return ret
        } else {
            const ret = new Trapezoid(x0, y0a, y0b, x1, y1a, y1b, col, z)
            Trapezoid.instances.push(ret)
            //console.log("ALLOCATED NEW trapezoid " + Trapezoid.instNum)
            ++Trapezoid.instNum
            return ret
        }
    }
    static resetInstances() {
        Trapezoid.instNum = 0
    }
    static eraseInstances() {
        Trapezoid.resetInstances()
        Trapezoid.instances = []
    }

    constructor(x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number, col: number, z: number) {
        this.buf = Buffer.create(8)
        this.set(x0, y0a, y0b, x1, y1a, y1b, col, z)
    }

/*
    set(x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number, col: number, z: number) {
        this.x0 = Math.floor(x0)
        this.y0a = Math.floor(y0a)
        this.y0b = Math.floor(y0b)
        this.x1 = Math.floor(x1)
        this.y1a = Math.floor(y1a)
        this.y1b = Math.floor(y1b)
        this.order = Math.floor(z)
        this.color = Math.floor(col)
    }
*/

    set(x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number, col: number, z: number = 0) {
        // For debugging, check that clipping resulted in valid coordinates. Don't leave
        // this in the production version since it would slow things down unnecessarily.
        /*
        if (y0a < 0 || y0a > 119 || y0b < 0 || y0b > 119 || y1a < 0 || y1a > 119 || y1b < 0 || y1b > 119) {
            console.log("clipping failed")
            throw("clipping failed")
        }
        if (x0 != Math.floor(x0) || y0a != Math.floor(y0a) || y0b != Math.floor(y0b) || y1a != Math.floor(y1a) || y1b != Math.floor(y1b) || col != Math.floor(col) || z != Math.floor(z)) {
            console.log("non-integer")
            throw("non-integer")
        }
        if (x1 < x0) throw("bad x1=" + x1 + " x0=" + x0)
        */
        this.buf.setUint8(0, x0)
        this.buf.setUint8(1, y0a)
        this.buf.setUint8(2, y0b)
        this.buf.setUint8(3, x1)
        this.buf.setUint8(4, y1a)
        this.buf.setUint8(5, y1b)
        this.buf.setUint8(6, z)
        this.buf.setUint8(7, col)
    }

    get x0() { return this.buf.getUint8(0) }
    get y0a() { return this.buf.getUint8(1) }
    get y0b() { return this.buf.getUint8(2) }
    get x1() { return this.buf.getUint8(3) }
    get y1a() { return this.buf.getUint8(4) }
    get y1b() { return this.buf.getUint8(5) }
    get order() { return this.buf.getUint8(6) }
    get color() { return this.buf.getUint8(7) }

/*
    set x0(v: number) { this.buf.setUint8(0, v) }
    set y0a(v: number) { this.buf.setUint8(1, v) }
    set y0b(v: number) { this.buf.setUint8(2, v) }
*/
}

const OUTSIDE_LEFT = 1
const OUTSIDE_RIGHT = 2
const OUTSIDE_TOP = 4
const OUTSIDE_BOTTOM = 8
const OUTSIDE_NEAR = 16
const OUTSIDE_ALL = 31
const NEW_POINT_BIT = 32

class Polygon {
    // Clip each polygon against the left/top/right/bottom screen edges. This list doesn't include the
    // near plane on the Z axis, that clipping step is done separately before perspective projection.
    // Entries: axis number (0=x, 1=y, 2=z), limit, corresponding flag value
    static screenEdgeAxes = [[0, 0, OUTSIDE_LEFT], [1, 0, OUTSIDE_TOP], [0, 159, OUTSIDE_RIGHT], [1, 119, OUTSIDE_BOTTOM]]

    // This function assumes that the polygon is convex, or at least its first three points are consistent with that.
    static isCounterclockwise(p0: number[], p1: number[], p2: number[]) {
        const crossZ = Math.imul(p1[0] - p0[0], p2[1] - p0[1]) - Math.imul(p1[1] - p0[1], p2[0] - p0[0])
        return (crossZ < 0)
    }

    static emitTrapezoid(xstarts: Drawable[][], x0: number, y0a: number, y0b: number, x1: number, y1a: number, y1b: number, col: number, order: number) {
        xstarts[x0].push(Trapezoid.addInstance(x0, y0a, y0b, x1, y1a, y1b, col, order))
    }

    static clipPolygon(points: number[][], clipOr: number, clipBits: number[], clipFunc: Function, edgeAxes: number[][], out_isNewPoint: boolean[] = null) {
        perfClipPoly.start()
        //control.enablePerfCounter()
        // Reentrant polygon clipping. Must be counterclockwise and convex, but doesn't need to be a triangle.

        let p_out: number[][]= []
        let clipBits_out: number[]
        let addEdge = function(points: number[][], clipBits: number[], a: number, b: number, axis: number, limit: number, outside_bit: number) {
            perfClipEdge.start()
            // Check that values remain integers. Don't enable in prod version, this is likely slow.
            //if (points[a][0] != Math.floor(points[a][0]) || points[a][1] != Math.floor(points[a][1]) || points[a][2] != Math.floor(points[a][2])) console.log("bad point: " + points[a].join(", "))
            //if (points[b][0] != Math.floor(points[b][0]) || points[b][1] != Math.floor(points[b][1]) || points[b][2] != Math.floor(points[b][2])) console.log("bad point: " + points[a].join(", "))

            if (!(clipBits[a] & outside_bit)) {
                    // Point A is visible
                if (!(clipBits[b] & outside_bit)) {
                    // Point B is visible
                    p_out.push(points[b])
                    clipBits_out.push(clipBits[b])
                } else {
                    // Point B is outside, add intersection point
                    const pa = points[a]
                    const pb = points[b]
                    let q = [0, 0, 0]
                    if (axis == 2) {
                        // Get X and Y values based on the Z distance
                        q[2] = limit
                        q[0] = pa[0] + scale_by_fraction(Math.abs(pa[2] - limit), pb[0] - pa[0], Math.abs(pb[2] - pa[2]))
                        q[1] = pa[1] + scale_by_fraction(Math.abs(pa[2] - limit), pb[1] - pa[1], Math.abs(pb[2] - pa[2]))
                    } else {
                        // 2D case, get X from Y distance or vice versa.
                        let other = 1 - axis
                        q[axis] = limit
                        q[other] = pa[other] + scale_by_fraction(Math.abs(pa[axis] - limit), pb[other] - pa[other], Math.abs(pb[axis] - pa[axis]))
                    }
                    p_out.push(q)
                    clipBits_out.push(clipFunc(q) | NEW_POINT_BIT)
                }
            } else {
                // Point A is outside
                if (!(clipBits[b] & outside_bit)) {
                    // Point B is visible, add intersection point and B
                    const pa = points[a]
                    const pb = points[b]
                    let q = [0, 0, 0]
                    if (axis == 2) {
                        q[2] = limit
                        q[0] = pa[0] + scale_by_fraction(Math.abs(pa[2] - limit), pb[0] - pa[0], Math.abs(pb[2] - pa[2]))
                        q[1] = pa[1] + scale_by_fraction(Math.abs(pa[2] - limit), pb[1] - pa[1], Math.abs(pb[2] - pa[2]))
                    } else {
                        let other = 1 - axis
                        q[axis] = limit
                        q[other] = pa[other] + scale_by_fraction(Math.abs(pa[axis] - limit), pb[other] - pa[other], Math.abs(pb[axis] - pa[axis]))
                    }
                    p_out.push(q)
                    clipBits_out.push(clipFunc(q) | NEW_POINT_BIT)
                    p_out.push(points[b])
                    clipBits_out.push(clipBits[b])
                } else {
                    // Point B is also outside, don't add any points
                }
            }
            perfClipEdge.end()
        }

        // Run the reentrant polygon clipping algorithm against the specified clip planes.
        for (let k = 0; k < edgeAxes.length; ++k) {
            if (!(clipOr & edgeAxes[k][2])) continue
            p_out = []
            clipBits_out = []
            for (let j = 0; j < points.length; ++j) {
                let i = (j == 0 ? points.length - 1 : j - 1)
                addEdge(points, clipBits, i, j, edgeAxes[k][0], edgeAxes[k][1], edgeAxes[k][2])
            }
            points = p_out
            clipBits = clipBits_out
        }

        /*
        for (let i = 0; i < points.length; ++i) {
            if (clipFunc(points[i])) throw("Clipping failed")
        }
        */

        if (out_isNewPoint) {
            //out_isNewPoint.length = clipBits.length
            for (let i = clipBits.length - 1; i >= 0; --i) {
                out_isNewPoint[i] = (clipBits[i] & NEW_POINT_BIT ? true : false)
            }
        }

        perfClipPoly.end()
        return points
    }

    // This assumes that the polygon is convex, it doesn't work right for concave ones and doesn't handle holes.
    static splitPolygonIntoTrapezoids(xstarts: Drawable[][], points: number[][], color: number, order: number) {
        //control.enablePerfCounter()
        let np = points.length
        if (!np) return

        let nextIdx = function(v: number) { return v == np - 1 ? 0 : v + 1 }
        let prevIdx = function(v: number) { return v == 0 ? np - 1 : v - 1 }

        // Find the smallest X coordinate and corresponding index.
        let minX = 99999
        let minIdx = -1
        for (let i = 0; i < np; ++i) {
            if (points[i][0] < minX) {
                minIdx = i
                minX = points[i][0]
            }
        }

        // Set up the starting point, or pair of points if two have the same X value.
        let idxTop = minIdx
        let idxBottom = minIdx
        let pointsUsed = 1
        if (points[prevIdx(minIdx)][0] == minX) {
            idxTop = prevIdx(minIdx)
            ++pointsUsed
        } else if (points[nextIdx(minIdx)][0] == minX) {
            idxBottom = nextIdx(minIdx)
            ++pointsUsed
        }
        let y0a = points[idxTop][1]
        let y0b = points[idxBottom][1]

        // Use each of the vertices at least once. This assumes that they aren't collapsed
        // into the same location.
        //console.log("points=" + points.map(x => x.join(",")).join(" "))
        while (pointsUsed < np) {
            //console.log("start: minX=" + minX + " pointsUsed=" + pointsUsed + "/" + np)
            //console.log("idxTop=" + idxTop + " idxBottom=" + idxBottom)
            // Find the next right-side point or pair of points, and emit a trapezoid for it.
            let nextTopP = points[prevIdx(idxTop)]
            let nextBottomP = points[nextIdx(idxBottom)]
            let y1a, y1b
            if (nextTopP[0] == nextBottomP[0]) {
                y1a = nextTopP[1]
                y1b = nextBottomP[1]
                Polygon.emitTrapezoid(xstarts, minX, y0a, y0b, nextTopP[0], y1a, y1b, color, order)
                idxTop = prevIdx(idxTop)
                idxBottom = nextIdx(idxBottom)
                pointsUsed += 2
                minX = nextTopP[0]
            } else if (nextTopP[0] < nextBottomP[0]) {
                y1a = nextTopP[1]
                y1b = y0b + scale_by_fraction(nextBottomP[1] - y0b, nextTopP[0] - minX, nextBottomP[0] - minX)
                Polygon.emitTrapezoid(xstarts, minX, y0a, y0b, nextTopP[0], y1a, y1b, color, order)
                idxTop = prevIdx(idxTop)
                pointsUsed += 1
                minX = nextTopP[0]
            } else {
                y1a = y0a + scale_by_fraction(nextTopP[1] - y0a, nextBottomP[0] - minX, nextTopP[0] - minX)
                y1b = nextBottomP[1]
                Polygon.emitTrapezoid(xstarts, minX, y0a, y0b, nextBottomP[0], y1a, y1b, color, order)
                idxBottom = nextIdx(idxBottom)
                pointsUsed += 1
                minX = nextBottomP[0]
            }
            // Done with this trapezoid, use its y1 values for the next one's y0.
            y0a = y1a
            y0b = y1b
            //console.log("end: minX=" + minX + " pointsUsed=" + pointsUsed + "/" + np)
            //console.log("idxTop=" + idxTop + " idxBottom=" + idxBottom)
        }
    }

    static tmpClipBits: number[] = []

    static clipAndDrawPolygon(xstarts: Drawable[][], points: number[][], color: number, order: number) {
        //control.enablePerfCounter()
        const clipFunc = Camera3d.clipBitsScreenEdges
        const clipBits = Polygon.tmpClipBits

        // This could use map and reduce, but it's preferable to avoid extra allocations.
        //const clipBits: number[] = points.map(p => clipFunc(p))
        let clipAnd = OUTSIDE_ALL
        let clipOr = 0
        for (let j = 0; j < points.length; ++j) {
            const bits = clipFunc(points[j])
            clipBits[j] = bits
            clipAnd &= bits
            clipOr |= bits
        }

        if (clipAnd) {
            // All points are outside, reject
            return
        }

        if (clipOr) {
            // Partially visible, clipping needed.
            points = Polygon.clipPolygon(points, clipOr, clipBits, clipFunc, Polygon.screenEdgeAxes)
        }

        Polygon.splitPolygonIntoTrapezoids(xstarts, points, color, order)
    }

    static clipAndDrawTriangle(xstarts: Drawable[][], p0: number[], p1: number[], p2: number[], color: number, order: number) {
        perfOutTri.start()
        //control.enablePerfCounter()
        const clipFunc = Camera3d.clipBitsScreenEdges
        const clip0 = clipFunc(p0)
        const clip1 = clipFunc(p1)
        const clip2 = clipFunc(p2)

        if (clip0 & clip1 & clip2) {
            perfOutTri.end()
            return
        }
        
        const clipOr = clip0 | clip1 | clip2
        if (clipOr) {
            // Partially visible, clipping needed.
            let points = Polygon.clipPolygon([p0, p1, p2], clipOr, [clip0, clip1, clip2], clipFunc, Polygon.screenEdgeAxes)
            Polygon.splitPolygonIntoTrapezoids(xstarts, points, color, order)
            perfOutTri.end()
            return
        }

        // Triangle is fully visible. Split into two trapezoids.

        perfOutTriSimple.start()
        // TODO: simply use Polygon.splitPolygonIntoTrapezoids()? It shouldn't be
        // noticeably slower.
        //Polygon.splitPolygonIntoTrapezoids(xstarts, [p0, p1, p2], [clip0, clip1, clip2], color, order)
        //return

        //console.log("i=" + i + " p0=" + p0.join(',') + " p1=" + p1.join(',') + " p2=" + p2.join(','))
        // Sort the points by X coordinate. This breaks winding order, so must be done after culling.
        if (p1[0] < p0[0]) [p0, p1] = [p1, p0]
        if (p2[0] < p0[0]) [p0, p2] = [p2, p0]
        if (p2[0] < p1[0]) [p1, p2] = [p2, p1]

        // Skip if zero width
        if (p0[0] == p2[0]) {
            perfOutTri.end()
            return
        }

        // Get the long edge intersection point opposite the center vertex
        const y2 = p0[1] + scale_by_fraction(p1[0] - p0[0], p2[1] - p0[1], p2[0] - p0[0])

        if (p1[0] == p0[0]) {
            Polygon.emitTrapezoid(xstarts, 
                                    p0[0], Math.min(p0[1], p1[1]), Math.max(p0[1], p1[1]),
                                    p1[0], Math.min(p1[1], y2), Math.max(p1[1], y2),
                                    color, order)
        } else {
            Polygon.emitTrapezoid(xstarts, p0[0], p0[1], p0[1],
                                    p1[0], Math.min(p1[1], y2), Math.max(p1[1], y2),
                                    color, order)
        }
        if (p2[0] == p1[0]) {
            Polygon.emitTrapezoid(xstarts, p1[0], Math.min(p1[1], y2), Math.max(p1[1], y2),
                                    p2[0], Math.min(p1[1], p2[1]), Math.max(p1[1], p2[1]),
                                    color, order)
        } else {
            Polygon.emitTrapezoid(xstarts, p1[0], Math.min(p1[1], y2), Math.max(p1[1], y2),
                                    p2[0], p2[1], p2[1],
                                    color, order)
        }        
        perfOutTriSimple.end()
        perfOutTri.end()
    }
}

class ActiveTrapezoid {
    base: Trapezoid
    a_dydx: Fx8
    b_dydx: Fx8
    a_y: Fx8
    b_y: Fx8

    constructor(base: Trapezoid) {
        this.set(base)
    }

    set(base: Trapezoid) {
        this.base = base
        this.a_dydx = Fx.idiv(Fx8(base.y1a - base.y0a), base.x1 - base.x0)
        this.b_dydx = Fx.idiv(Fx8(base.y1b - base.y0b), base.x1 - base.x0)
        this.a_y = Fx8(base.y0a)
        this.b_y = Fx8(base.y0b)
    }
}

class Camera3d {
    pixel_scale: number
    right: number
    top: number
    rightTan: number
    rightTanFP: number
    upTan: number
    upTanFP: number
    rightNormal: number[]
    leftNormal: number[]
    upNormal: number[]
    downNormal: number[]
    
    static nearZ: number
    
    constructor(horizontalFovDegrees: number) {
        // Perspective calculation doesn't use near and far planes. Those would normally
        // be used to calculate depth buffer values, but the painter's algorithm
        // doesn't need these. The scaling is just based on FoV angles and
        // pixel sizing.
        this.rightTan = Math.tan(horizontalFovDegrees / 2 * Math.PI / 180)
        this.upTan = this.rightTan * 120 / 160

        // These values are used for frustum culling, make them a bit too large to 
        // ensure culling isn't too aggressive in case of rounding errors.
        this.rightTanFP = Math.ceil(this.rightTan * FP_ONE)
        this.upTanFP = Math.ceil(this.upTan * FP_ONE)

        // Outward-facing normal vectors for four sides of the view frustum, 
        // for use with viewport culling.
        this.rightNormal = [FP_ONE, 0, Math.floor(this.rightTan * FP_ONE)]
        normalizeFP(this.rightNormal)
        this.leftNormal = [-this.rightNormal[0], this.rightNormal[1], this.rightNormal[2]]
        this.upNormal = [0, FP_ONE, Math.floor(this.upTan * FP_ONE)]
        normalizeFP(this.upNormal)
        this.downNormal = [this.upNormal[0], -this.upNormal[1], this.upNormal[2]]

        const rightPixels = 80
        this.pixel_scale = Math.floor(rightPixels * FP_ONE / this.rightTan) 

        // The near plane is used for object culling and polygon clipping. It can
        // be quite close since it doesn't affect Z buffer resolution, it just
        // needs to avoid divide-by-zero errors. Must be negative since the
        // camera is at the origin looking in the -Z direction.
        Camera3d.nearZ = -Math.floor(FP_ONE / 16)
    }

    diagonalHalfFovDegrees() {
        const x = this.rightTan
        const y = this.upTan
        const diagTan = Math.sqrt(x * x + y * y)
        return 180 * Math.atan(diagTan) / Math.PI
    }

    // Transforms from viewer space to screen coordinates. Doesn't calculate
    // a z distance, keeping world-space z unchanged. Returns true if successfully
    // transformed, false if behind the camera.
    perspectiveTransform(vert: number[]) {
        //control.enablePerfCounter()
        // We shouldn't be transforming any points on the wrong side of the near Z plane
        // at this point, clipping is supposed to take care of them.
        //if (vert[2] > Camera3d.nearZ) throw("Bad Z")

        const w = -vert[2]
        // Calculate screen coordinates by scaling NDC coordinates
        const pixel_scale = this.pixel_scale
        const x = Math.idiv(Math.imul(vert[0], pixel_scale), w) >> FP_BITS
        const y = Math.idiv(Math.imul(vert[1], pixel_scale), w) >> FP_BITS
        // Skipping the Z calculation since it's not needed for the painter's algorithm.
        //const z = Math.floor((-vert[2] * (far + near) - 2 * far * near) * FP_ONE / (far - near) * FP_ONE / w)
        vert[0] = x + 80
        vert[1] = 60 - y
    }

    // Check if a point is outside the screen x/y limits on any side.
    // Store the result in a bitmap.
    static clipBitsScreenEdges = function(p: number[]) : number {
        return (p[0] < 0 ? OUTSIDE_LEFT : 0) | (p[0] > 159 ? OUTSIDE_RIGHT : 0) | (p[1] < 0 ? OUTSIDE_TOP : 0) | (p[1] > 119 ? OUTSIDE_BOTTOM : 0)
    }

    // Clip check for the near plane only
    static clipBitsNearPlane = function(p: number[]) : number {
        return (p[2] > Camera3d.nearZ ? OUTSIDE_NEAR : 0)
    }

    // Clip check for the view frustum including near plane. The frustum sides check
    // is a bit conservative (thanks to {right,up}TanFP being rounded up) so that
    // rounding errors don't reject points too aggressively.
    getClipBitsFrustum() {
        const rightTanFP = this.rightTanFP
        const upTanFP = this.upTanFP
        return function(p: number[]) : number {
            const nz = -p[2]
            let bits = 0
            if (p[0] > Math.imul(nz, rightTanFP) >> FP_BITS) bits |= OUTSIDE_RIGHT
            if (p[0] < Math.imul(nz, -rightTanFP) >> FP_BITS) bits |= OUTSIDE_LEFT
            if (p[1] > Math.imul(nz, upTanFP) >> FP_BITS) bits |= OUTSIDE_TOP
            if (p[1] < Math.imul(nz, -upTanFP) >> FP_BITS) bits |= OUTSIDE_BOTTOM
            if (p[2] > Camera3d.nearZ) bits |= OUTSIDE_NEAR
            return bits
        }
    }
}


class InstanceBase {
    worldFromModel: number[]
    viewerFromModel: number[]

    constructor() {
        this.worldFromModel = []
        this.viewerFromModel = []
        mat_setIdentity_FP(this.worldFromModel)
        mat_setIdentity_FP(this.viewerFromModel)
    }

    getX() {
        // Viewer space Z coordinate of this object's origin
        return this.viewerFromModel[9]
    }
    getY() {
        // Viewer space Z coordinate of this object's origin
        return this.viewerFromModel[10]
    }
    getZ() {
        // Viewer space Z coordinate of this object's origin
        return this.viewerFromModel[11]
    }

    culled(model: MeshModelBase, camera: Camera3d) {
        // Calculate origin position in viewer space
        const vp = [this.viewerFromModel[9], this.viewerFromModel[10], this.viewerFromModel[11]]
        const radius = model.boundingSphereRadius
        //if (vp[2] > 0) {
        if (vp[2] > radius + Camera3d.nearZ) {
            //console.log(" vp=" + vp.join(", ") + " cull Z, " + vp[2] + " > " + -radius)
            return true
        }

        if (dot_FP(vp, camera.rightNormal) > radius) return true
        if (dot_FP(vp, camera.leftNormal) > radius) return true
        if (dot_FP(vp, camera.upNormal) > radius) return true
        if (dot_FP(vp, camera.downNormal) > radius) return true

        return false
    }

    preRender(renderer: Renderer3d) {
        perfPreRender.start()
        // Calculate viewer space from model
        mul_mat43_mat43_FP(this.viewerFromModel, renderer.viewerFromWorld, this.worldFromModel)
        perfPreRender.end()
    }
}

namespace shader3d {
    export function getDiffuseShader(light: number[], col0: number, col1: number) {
        return (normal: number[], unused_z: number) => {
            let dot = dot_FP(normal, light)

            // Regular shading: diffuse + ambient. Downside is that the unlit
            // side is a single color with no details.
            return col0 + (dot > 0 ? (dot * (col1 - col0) >> FP_BITS) : 0)
        }
    }

    export function getHalfAngleDiffuseShader(light: number[], col0: number, col1: number) {
        return (normal: number[], unused_z: number) => {
            let dot = dot_FP(normal, light)

            // Modified shading: diffuse mapping the full -1..1 range to a
            // a continuous gradient, including the normally-unlit side.
            return col0 + ((dot + FP_ONE) * (col1 - col0) >> FP_BITS >> 1)
        }
    }

    export function applyDistanceDimming(baseShader: Function, maxDistFP: number, col0: number) {
        // Brightness drops slowly at first, then more steeply towards zero at maxDist
        // Formula: y = 1 - x * x
        return (normal: number[], z: number) => {
            const baseCol = baseShader(normal, z)
            if (z < 0) return col0 + baseCol
            if (z >= maxDistFP) return col0
            const x = Math.idiv(z << FP_BITS, maxDistFP)
            const factor = FP_ONE_SQ - Math.imul(x, x)
            return col0 + (Math.imul(factor, baseCol) >> FP_BITS_SQ)

            // Alternative: linear brightness drop, this seems a bit too dark.
            //return Math.idiv(Math.imul(maxDistFP - z, baseCol), maxDistFP)
        }
    }
}

class MeshModelBase {
    vertices: number[][]
    faces: number[][]
    faceNormals: number[][]
    boundingSphereRadius: number

    // The following members are temporary data used for instance rendering 
    // by drawInstance, they are not valid outside that function.

    // Vertex coordinates in viewer space (before perspective transform)
    // or screen space (after perspective transform), one per vertex.
    // [0, 1, 2] is x, y, z.
    vert_V: number[][]

    // An array of points for each face, using references to vert_V entries.
    faces_V: number[][][] 

    // Face normals in world space, used for lighting. One per face.
    faceNormals_W: number[][]

    //clippedFaces: number[][][]

    // For the clippedFaces array, store the matching index in the faces and
    // faceNormals arrays since it can skip entries.
    faceIndex: number[]

    clipBitsFace: number[]
    clipBitsVertV: number[]

    // Distance from cube center to a corner, for use with distance shading
    static cubeCornerDistance = Math.floor(Math.sqrt(1 + 1 + 1) * FP_ONE)

    constructor() {
        this.vertices = []
        this.faces = []
        this.faceNormals = []
        this.boundingSphereRadius = 0 // unknown, override in instance

        // Temporary data used while rendering instances
        this.vert_V = []
        this.faces_V = []
        this.faceNormals_W = []
        //this.clippedFaces = []
        this.faceIndex = []
        this.clipBitsFace = []
        this.clipBitsVertV = []
    }

    calculateNormalVectorsFromFaces() {
        // Calculate normal vectors for the faces, used for lighting
        const vertices = this.vertices
        const faces = this.faces
        for (let i = 0; i < faces.length; ++i) {
            let p0 = vertices[faces[i][0]]
            let p1 = vertices[faces[i][1]]
            let p2 = vertices[faces[i][2]]
            let a = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]
            let b = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]
            // Normal vector is cross product of (p0 to p1) and (p0 to p2) vectors
            let n = [Math.imul(a[1], b[2]) - Math.imul(a[2], b[1]),
                     Math.imul(a[2], b[0]) - Math.imul(a[0], b[2]),
                     Math.imul(a[0], b[1]) - Math.imul(a[1], b[0])]
            normalizeFP(n)
            this.faceNormals.push(n)
        }
    }

    applyVertexTransform(instance: InstanceBase) {
        perfVertexTransform.start()
        //control.enablePerfCounter()
        // Apply model-to-world transform to normal vectors
        for (let i = 0; i < this.faceNormals.length; ++i) {
            if (!this.faceNormals_W[i]) this.faceNormals_W[i] = [0, 0, 0]
            mul_mat33_vec_FP(this.faceNormals_W[i], instance.worldFromModel, this.faceNormals[i])

            // Normalizing is needed if the world matrix includes scaling. A uniform scale
            // could be more efficiently handled by just dividing by the scale factor.
            //normalizeFP(this.faceNormals_W[i])
        }

        // Appply model-to-view transforms to vertices
        const vertices = this.vertices
        const vert_V = this.vert_V
        for (let i = 0; i < this.vertices.length; ++i) {
            if (!vert_V[i]) vert_V[i] = [0, 0, 0]
            mul_mat43_vec_FP(vert_V[i], instance.viewerFromModel, vertices[i])
        }

        if (!this.faces_V.length) {
            this.faces_V = this.faces.map(face => face.map(idx => vert_V[idx]))
        }
        perfVertexTransform.end()
    }

    drawFaces(renderer: Renderer3d, camera: Camera3d, shader: Function, instance: InstanceBase, opt_faceOrder: number[]=null) {
        //control.enablePerfCounter()
        const vert_V = this.vert_V
        const faceIndex = this.faceIndex

        // If the caller didn't supply per-face order numbers, allocate one for all to share.
        const commonOrder = opt_faceOrder ? -1 : renderer.getOrderNum()

        // TODO: remove these, for statistics only.
        /*
        let rejectZ = 0
        let clipZ = 0
        let visibleZ = 0
        let transformedVertV = 0
        */

        // Clip polygons at the near plane. This can result in modified faces.
        const clipVertices = []
        const clippedFaces = []
        const clipBitsFace = this.clipBitsFace
        const clipBitsVertV = this.clipBitsVertV
        const clipFuncFrustum = camera.getClipBitsFrustum()
        const clipFuncNearPlane = Camera3d.clipBitsNearPlane
        for (let i = 0; i < vert_V.length; ++i) {
            clipBitsVertV[i] = clipFuncFrustum(vert_V[i])
        }

        perfClipWorld.start()
        for (let i = 0; i < this.faces.length; ++i) {
            const faceIn = this.faces[i]
            const points = this.faces_V[i]
            //const points = faceIn.map(idx => vert_V[idx])

            // TODO: specialize for triangle?

            // Clip at nearZ plane. Also add x/y outside-the-frustum checks to
            // early-reject fully invisible polygons, but don't use those
            // when deciding to run the clipping algorithm.

            let clipAnd = OUTSIDE_ALL
            let clipOr = 0
            for (let j = 0; j < points.length; ++j) {
                const bits = clipBitsVertV[faceIn[j]]
                clipBitsFace[j] = bits & OUTSIDE_NEAR
                clipAnd &= bits
                clipOr |= bits
            }

            if (clipAnd) {
                // All points are outside, reject
                //++rejectZ
                continue
            } else if (clipOr & OUTSIDE_NEAR) {
                //++clipZ
                // Partially visible, clipping on Z needed.
                const clipZAxis = [[2, Camera3d.nearZ, OUTSIDE_NEAR]]

                const isNew: boolean[] = []
                const clippedPoints = Polygon.clipPolygon(points, clipOr, clipBitsFace, clipFuncNearPlane, clipZAxis, isNew)
                for (let j = 0; j < clippedPoints.length; ++j) {
                    if (isNew[j]) {
                        // Clipping added this point as a new point, so add it to the list
                        // of points needing a separate perspective transform.
                        clipVertices.push(clippedPoints[j])
                    }
                }
                faceIndex[clippedFaces.length] = i
                clippedFaces.push(clippedPoints)
            } else {
                //++visibleZ
                // Fully visible or needs clipping on X/Y, use the original points.
                faceIndex[clippedFaces.length] = i
                clippedFaces.push(points)
            }
        }
        perfClipWorld.end()

        perfPerspective.start()
        // Set screen coordinates of vert_V, skipping points on the wrong side of nearZ.
        for (let i = 0; i < vert_V.length; ++i) {
            if (clipBitsVertV[i] & OUTSIDE_NEAR) continue

            camera.perspectiveTransform(vert_V[i])
            //++transformedVertV
        }
        // Set screen coordinates of the vertices added by nearZ clipping
        for (let i = 0; i < clipVertices.length; ++i) {
            camera.perspectiveTransform(clipVertices[i])
        }
        perfPerspective.end()

        /*
        console.log("faces=" + clippedFaces.length + "/" + this.faces.length + 
                    " vertices=" + vert_V.length + "+" + clipVertices.length +
                    " Z visible=" + visibleZ + " clipped=" + clipZ + " rejected=" + rejectZ +
                    " transformedVertV=" + transformedVertV)
        */

        perfaddTrapezoids.start()
        // Now output the Z-clipped faces, checking winding order and doing screen-space clipping.
        for (let i = 0; i < clippedFaces.length; ++i) {
            const face = clippedFaces[i]
            const origIndex = faceIndex[i]

            const np = face.length
            if (np == 3) {
                let p0 = face[0]
                let p1 = face[1]
                let p2 = face[2]

                // Front face culling - ensure screen-space triangle is counterclockwise in world
                // space, this is clockwise in the left-handed NDC space, and counterclockwise
                // in screen space which is again right-haded with Y increasing downward. Screen
                // space X increases to the right, screen space Z increases into the screen (away
                // from the camera).
                if (!Polygon.isCounterclockwise(p0, p1, p2)) continue

                // Calculate lighting for the face based on the world-space normal vector, and
                // optionally the instance's viewer-space Z and face number. Don't use vertex
                // coordinates here since those have been transformed into screen space.
                //
                // TODO: implement per-face color (or color range)
                //
                // TODO: if instances and light don't rotate, could precalculate the dot product. 
                //
                // TODO: avoid duplicating this. Is the triangle specialization worth it?
                const color = Math.floor(shader(this.faceNormals_W[origIndex], -instance.viewerFromModel[11], origIndex))
                const order = opt_faceOrder ? opt_faceOrder[origIndex] : commonOrder
                if (opt_faceOrder && !order) continue

                Polygon.clipAndDrawTriangle(renderer.xstarts, p0, p1, p2, color, order)
            } else {
                const points = face

                if (np >= 6) {
                    // For many-sided convex polygons, use points somewhat evenly spaced around
                    // the perimeter for the counterclockwise check. Otherwise, rounding errors
                    // may result in a wrong value for the cross product vector for sequential
                    // points that are almost in a straight line.
                    const i0 = 0
                    const i1 = Math.idiv(np, 3)
                    const i2 = Math.idiv(np << 1, 3)
                    if (!Polygon.isCounterclockwise(points[i0], points[i1], points[i2])) continue
                } else {
                    if (!Polygon.isCounterclockwise(points[0], points[1], points[2])) continue
                }

                const color = Math.floor(shader(this.faceNormals_W[origIndex], -instance.viewerFromModel[11], origIndex))
                const order = opt_faceOrder ? opt_faceOrder[origIndex] : commonOrder
                if (opt_faceOrder && !order) continue

                Polygon.clipAndDrawPolygon(renderer.xstarts, points, color, order)
            }
        }
        perfaddTrapezoids.end()
    }

    drawInstance(renderer: Renderer3d, camera: Camera3d, shader: Function, instance: InstanceBase) {
        /*
        if (order == 0) {
            Polygon.clipAndDrawTriangle(renderer.xstarts,
                [80, -70, 0],
                [-40, 90, 0],
                [180, 150, 0], 30, 254)

            Polygon.clipAndDrawTriangle(renderer.xstarts,
                [40, -40, 0],
                [120, 160, 0],
                [150, 200, 0], 50, 255)
        }
        */

        if (instance.culled(this, camera)) return

        // Transform the vertices and normal vectors for the current instance,
        // storing the results in this.vert_V and this.faceNormals_W.
        this.applyVertexTransform(instance)

        this.drawFaces(renderer, camera, shader, instance)
    }
}

class IcosahedronModel extends MeshModelBase {
    // See http://eusebeia.dyndns.org/4d/icosahedron for coordinates
    // psi is the Golden Ratio, about 1.618
    static phi = (1 + Math.sqrt(5)) / 2
    //         ^
    //         |y
    //        2,8
    // 4       |      5
    //    0,10 | 1,11
    // ----*---+--*-----> x
    //         |
    // 6       |      7
    //        3,9
    // +z = front of screen
    static verticesFloat = [
        [-1, 0, IcosahedronModel.phi], // 0
        [1, 0, IcosahedronModel.phi], // 1
        [0, IcosahedronModel.phi, 1], // 2
        [0, -IcosahedronModel.phi, 1], // 3
        [-IcosahedronModel.phi, 1, 0], // 4
        [IcosahedronModel.phi, 1, 0], // 5
        [-IcosahedronModel.phi, -1, 0], // 6
        [IcosahedronModel.phi, -1, 0], // 7
        [0, IcosahedronModel.phi, -1], // 8
        [0, -IcosahedronModel.phi, -1], // 9
        [-1, 0, -IcosahedronModel.phi], // 10
        [1, 0, -IcosahedronModel.phi], // 11
    ]

    // Triangle vertices for each face, in counterclockwise order 
    // when viewed from the outside.
    static facesSource = [
        [0, 1, 2],
        [0, 2, 4],
        [0, 4, 6],
        [0, 6, 3],
        [0, 3, 1],
        [1, 5, 2],
        [1, 7, 5],
        [1, 3, 7],
        [2, 8, 4],
        [2, 5, 8],
        [3, 6, 9],
        [3, 9, 7],
        [10, 8, 11],
        [10, 4, 8],
        [10, 6, 4],
        [10, 9, 6],
        [10, 11, 9],
        [11, 8, 5],
        [11, 5, 7],
        [11, 7, 9]
    ]

    constructor() {
        super()
        this.boundingSphereRadius = 2 << FP_BITS
        const verticesFloat = IcosahedronModel.verticesFloat
        this.faces = IcosahedronModel.facesSource

        // Convert vertices to fixed point
        const vertices = this.vertices
        for (let i = 0; i < verticesFloat.length; ++i) {
            let vert = verticesFloat[i]
            vertices.push([Math.floor(vert[0] * FP_ONE),
                           Math.floor(vert[1] * FP_ONE),
                           Math.floor(vert[2] * FP_ONE)])
        }

        this.calculateNormalVectorsFromFaces()
    }
}
