/*************************************************
Space Rocks 3D!
Comment just for a test GitHub commit

Release notes

v0.16:
- fix title
- analog joystick control

v0.15:
- add joystick Y invert/normal setting
- removed chess stuff, add back asteroids and wave select
- add simpleperf counters
- fix unnecessary edge clipping
- remove debug check for edge clipping
- merge sort for active trapezoids
- much faster dither algorithm (very close to flat shading speed)
- fix slowdown due to float multiplier
- add Fx.{sin,cos}Fx8 polynomial approximation
- more perf trace points for vertex xform etc

v0.14:
- move boundingSphereRadius from instance to model (this would need to be changed for scalable instances?)
- implemented near-plane Z clipping
- added TreeMesh that handles occlusion via binary space partition (BSP) tree
- making a change to test cloud save
- bugfix: make sure the split plane gets a drawing priority assigned
- started move to Fx8 math
- fixed 30bit number overflow in starfield draw

v0.11:
- only apply a wave change when resuming the game. (This fixes the issue of getting stuck at a higher difficulty.)
- change text for "Start Wave" to "Skip to wave" or "Start next game at wave" dynamically
- TODO: this version was never published

v0.10:
- Use the Menu button to enter the setup screen 
- added menu items:
  - volume control
  - number of stars
  - reset game
  - system menu
- Bugfix: reset asteroids when shrinking world size

v0.9 (unreleased):
- added volume control to setup screen
- made the distance fade effect less dark
- menu button while in game opens setup screen
- menu button from setup screen opens system menu
- the setting screen now scrolls to save space

v0.8:
- bugfix: tilt yaw stayed on accidentally for other modes.
- adjustable world size, defaults to a medium size to avoid being too easy
- add distance-based shading

v0.7:
- press B button to boost speed
- wrap-around playing area. Asteroids no longer bounce off invisible walls.
- ensure asteroids have a bit of clearance when starting new waves
- add setup screen with control and wave selector, settings are persistent
- added control scheme: stick roll + tilt yaw
- memory savings and speedup
*************************************************/

// Enable the following code to analyze memory usage. Output
// is printed to the JavaScript console. This is inefficient,
// remember to disable it before sharing it.
/*
game.onUpdateInterval(5000, function () {
    control.heapSnapshot()
    console.log("FIXME, heap snapshot active, disable this before sharing")
})
*/

// When making incompatible changes to the saved settings, call this one time
// to reset the stored configuration.
//settings.clear()

const perfRotate = simpleperf.getCounter("rotateModel")

class AsteroidInstance extends InstanceBase {
    initialRotation: number[]
    velocity: Fx8[]
    angle: Fx8
    angularVelocity: Fx8
    worldSize: number

    constructor(wave: number, instance: number, worldSize: number) {
        super()

        // Save the world size for movement updates. If it changes, asteroids
        // need to be regenerated.
        this.worldSize = worldSize

        // Set up a random initial rotation axis
        this.initialRotation = []
        mat_setIdentity_FP(this.initialRotation)
        rotateX_mat33_FP(this.initialRotation, Fx8(Math.random() * 2))
        rotateY_mat33_FP(this.initialRotation, Fx8(Math.random() * 2))
        rotateZ_mat33_FP(this.initialRotation, Fx8(Math.random() * 2))

        // Initial velocity and angular velocity
        this.velocity = [Fx.zeroFx8, Fx.zeroFx8, Fx.zeroFx8]
        if (wave > 0) {
            const alpha = Math.random() * Math.PI * 2
            const beta = Math.acos(Math.random() * 2 - 1)
            const speed = Math.random() * wave + 0.3
            this.velocity[0] = Fx8(Math.cos(alpha) * Math.cos(beta) * speed / 20)
            this.velocity[1] = Fx8(Math.sin(alpha) * Math.cos(beta) * speed / 20)
            this.velocity[2] = Fx8(Math.sin(beta) * speed / 20)
        }

        this.angle = Fx.zeroFx8
        this.angularVelocity = Fx8((Math.random() + 0.1) * 2 / 100)

        if (wave > 0) {
            // Randomly place new asteroids, but not too close to the player or to the edge.
            const distRange = worldSize * FP_ONE
            const randSign = () => Math.random() > 0.5 ? 1 : -1
            const minDistanceSquared = 100 << FP_BITS_SQ
            const maxDistanceSquared = Math.imul(worldSize, worldSize) << FP_BITS_SQ
            while (true) {
                const x = Math.floor(randSign() * (Math.random() * distRange))
                const y = Math.floor(randSign() * (Math.random() * distRange))
                const z = Math.floor(randSign() * (Math.random() * distRange))
                const r = Math.imul(x, x) + Math.imul(y, y) + Math.imul(z, z)
                if (x * x + y * y + z * z < minDistanceSquared) continue
                if (x * x + y * y + z * z >= maxDistanceSquared) continue
                this.worldFromModel[9] = x
                this.worldFromModel[10] = y
                this.worldFromModel[11] = z
                break
            }
        } else {
            // First wave has non-moving asteroids at fixed positions.
            const offset = (instance + (instance & 1 ? 0.5 : 0)) * Math.PI * 2 / 3
            this.worldFromModel[9] = Math.floor((Math.cos(offset) * 10) * FP_ONE)
            this.worldFromModel[10] = Math.floor(((instance & 1 ? 5 : -5)) * FP_ONE)
            this.worldFromModel[11] = Math.floor((Math.sin(offset) * 10 - 17) * FP_ONE)

            /*
            if (instance == 0) {
                this.worldFromModel[9] = 0
                this.worldFromModel[10] = 0
                this.worldFromModel[11] = -6 * FP_ONE
            }
            */
        }
    }
    
    updateWorldFromModel(multiplier: Fx8, shipMove: Fx8[], isSetupScreen: boolean) {
        perfRotate.start()
        this.angle = Fx.add(this.angle, Fx.mul(this.angularVelocity, multiplier))
        mul_mat33_rotateX_partial_FP(this.worldFromModel, this.initialRotation, this.angle)
        perfRotate.end()

        // If the game is paused, let asteroids rotate but stop them from moving.
        if (isSetupScreen) return

        // The playing area is a large sphere centered around the player ship.
        // If rocks exit it, make them reappear from the opposite side. The
        // new point isn't guaranteed to be inside the sphere, for example if it
        // is nearly grazing the surface, but that's OK since rocks near the
        // surface are dimmed.

        const oldX = this.worldFromModel[9]
        const oldY = this.worldFromModel[10]
        const oldZ = this.worldFromModel[11]
        this.worldFromModel[9] += Fx8_to_FP(Fx.sub(Fx.mul(this.velocity[0], multiplier), shipMove[0]))
        this.worldFromModel[10] += Fx8_to_FP(Fx.sub(Fx.mul(this.velocity[1], multiplier), shipMove[1]))
        this.worldFromModel[11] += Fx8_to_FP(Fx.sub(Fx.mul(this.velocity[2], multiplier), shipMove[2]))
        const x = this.worldFromModel[9]
        const y = this.worldFromModel[10]
        const z = this.worldFromModel[11]

        const limit = Math.imul(this.worldSize, this.worldSize) << FP_BITS_SQ
        if (Math.imul(x, x) + Math.imul(y, y) + Math.imul(z, z) > limit) {
            this.worldFromModel[9] = -oldX
            this.worldFromModel[10] = -oldY
            this.worldFromModel[11] = -oldZ
        }
    }
}

// The "Spray" particle effect doesn't have a configurable color,
// resulting in near-invisible particles. This is a copy with a modified
// color value. Source:
// https://github.com/microsoft/pxt-common-packages/blob/master/libs/game/particlefactories.ts#L94
class ExplodeFactory extends particles.SprayFactory {
    constructor(speed: number, centerDegrees: number, arcDegrees: number) {
        super(speed, centerDegrees, arcDegrees);
    }
    drawParticle(particle: particles.Particle, x: Fx8, y: Fx8) {
        screen.setPixel(Fx.toInt(x), Fx.toInt(y), 15);
    }
}
const particleExplode = new effects.ParticleEffect(400, 100, function (anchor: particles.ParticleAnchor, particlesPerSecond: number) {
    const factory = new ExplodeFactory(200, 0, 359)
    const src = new particles.ParticleSource(anchor, particlesPerSecond, factory);
    src.setAcceleration(0, 0);
    return src;
});

const perfRadar = simpleperf.getCounter("radar")

// A radar viewer similar to that in the game Elite. This essentially shrinks
// the xyz coordinates of the asteroids into a small box, places that box in
// viewer space where the radar image should appear, and applies the camera's
// perspective transform to the resulting positions.
class Radar {
    drawFrame: Function
    draw: Function

    pos: number[]

    constructor(camera: Camera3d) {
        const yoffset = -Math.floor(camera.upTan * 0.9 * FP_ONE)
        const zoffset = -Math.floor(1.2 * FP_ONE)
        const xsize = Math.floor(camera.rightTan / 2 * FP_ONE)
        const ysize = Math.floor(camera.upTan / 2 * FP_ONE)
        const zsize = Math.floor(xsize * 0.5)

        const pc = [0, yoffset, zoffset]
        const p00 = [-xsize, yoffset, zoffset + zsize]
        const p01 = [-xsize, yoffset, zoffset - zsize]
        const p10 = [xsize, yoffset, zoffset + zsize]
        const p11 = [xsize, yoffset, zoffset - zsize]
        camera.perspectiveTransform(pc)
        camera.perspectiveTransform(p00)
        camera.perspectiveTransform(p01)
        camera.perspectiveTransform(p10)
        camera.perspectiveTransform(p11)

        this.drawFrame = function(img: Image, dx: number, dy: number) {
            img.drawLine(p00[0] + dx, p00[1] + dy, p01[0] + dx, p01[1] + dy, 12)
            img.drawLine(p01[0] + dx, p01[1] + dy, p11[0] + dx, p11[1] + dy, 12)
            img.drawLine(p11[0] + dx, p11[1] + dy, p10[0] + dx, p10[1] + dy, 12)
            img.drawLine(p10[0] + dx, p10[1] + dy, p00[0] + dx, p00[1] + dy, 12)
            img.drawLine(pc[0] + dx, pc[1] + dy, p01[0] + dx, p01[1] + dy, 8)
            img.drawLine(pc[0] + dx, pc[1] + dy, p11[0] + dx, p11[1] + dy, 8)
        }

        const pos = [0, 0, 0]

        this.draw = function(img: Image, sceneCamera: scene.Camera, asteroids: AsteroidInstance[], worldSize: number, isSetupScreen: boolean, useCockpit: boolean) {
            if (isSetupScreen) return

            perfRadar.start()
            // Factor to downsize the regular world to the radar box
            const rscale = Math.floor(FP_ONE / worldSize)
            let shakeX = -sceneCamera.drawOffsetX
            let shakeY = -sceneCamera.drawOffsetY
            if (!useCockpit) {
                this.drawFrame(img, shakeX, shakeY)
            }
            const drawObject = function(instance: InstanceBase, col: number) {
                const ax = instance.getX()
                const ay = instance.getY()
                const az = instance.getZ()
                pos[0] = Math.imul(ax, rscale) >> FP_BITS
                pos[1] = (Math.imul(ay, rscale) >> FP_BITS) + yoffset
                pos[2] = (Math.imul(az, rscale) >> FP_BITS) + zoffset
                pos[0] = Math.clamp(-xsize, xsize, pos[0])
                pos[1] = Math.clamp(yoffset - ysize, yoffset + ysize, pos[1])
                pos[2] = Math.clamp(zoffset - zsize, zoffset + zsize, pos[2])
                camera.perspectiveTransform(pos)
                const x = pos[0]
                const y1 = pos[1]
                pos[1] = yoffset
                camera.perspectiveTransform(pos)
                const y0 = pos[1]

                /*
                const proxLimitSq = 16 << FP_BITS_SQ
                const proxDistSq = Math.imul(ax, ax) + Math.imul(ay, ay) + Math.imul(az, az)
                const isClose = (proxDistSq <= proxLimitSq)

                img.drawRect(x + shakeX, y0 + shakeY, 1, y1 - y0, isClose ? 1 : 10)
                img.drawRect(x + shakeX, y1 + shakeY - 1, 2, 2, isClose ? 1 : col)
                */
                img.drawRect(x + shakeX, y0 + shakeY, 1, y1 - y0, 10)
                img.drawRect(x + shakeX, y1 + shakeY - 1, 2, 2, col)
            }
            for (let i = 0; i < asteroids.length; ++i) {
                drawObject(asteroids[i], 12)
            }                
            perfRadar.end()
        }
    }
}

const perfStarfield = simpleperf.getCounter("starfield")

class Starfield {
    starX: Fx8[]
    starY: Fx8[]
    starColor: number[]
    numStars: number

    starAngle: number
    starCos: number
    starSin: number
    starX0: number
    starY0: number
    diagonalHalfFovDegrees: number
    radiansToShift: number

    constructor(camera: Camera3d, numStars: number) {
        this.starX = []
        this.starY = []
        this.starColor = []
        this.numStars = numStars

        this.starAngle = 0
        this.starCos = 1
        this.starSin = 0
        this.starX0 = 0
        this.starY0 = 0

        for (let i = 0; i < numStars; ++i) {
            this.starX.push(Fx8(Math.random() * 2))
            this.starY.push(Fx8(Math.random() * 2))
            this.starColor.push(Math.floor(Math.random() * 11 + 4))
        }

        // The starfield movement needs to be matched to the camera field of view.
        // The stars are drawn in a square that's rotated around the center of the
        // screen, and the square is just big enough to cover the corners of the
        // rectangular screen. Use the renderer camera field of view angle for
        // that diagonal when calculating star motion.
        const diagonalHalfFovRadians = camera.diagonalHalfFovDegrees() * Math.PI / 180
        //console.log("diagonalHalfFovDegrees=" + this.diagonalHalfFovDegrees)

        // Shifting the field of view by diagonalHalfFovDegrees should change
        // the star X0/Y0 offset by 0.5.
        this.radiansToShift = 1 / diagonalHalfFovRadians / 2
    }

    draw(img: Image) {
        perfStarfield.start()
        // Screen center to corner is sqrt(80^2 + 60^2) = 100 pixels,
        // the starfield must extend at least that far in each direction
        // from the origin.
        /*
        const starCos100 = Math.round(this.starCos * 100 * FP_ONE)
        const starSin100 = Math.round(this.starSin * 100 * FP_ONE)
        const starX0FP = Math.round(this.starX0 * FP_ONE_SQ)
        const starY0FP = Math.round(this.starY0 * FP_ONE_SQ)
        for (let i = 0; i < this.numStars; ++i) {
            const x = ((this.starX[i] + starX0FP) & FP_ONE_SQ_MASK) * 2 - FP_ONE_SQ
            const y = ((this.starY[i] + starY0FP) & FP_ONE_SQ_MASK) * 2 - FP_ONE_SQ
            const xs = 80 + (Math.imul(x, starCos100) - Math.imul(y, starSin100) >> FP_BITS_3)
            const ys = 60 + (Math.imul(x, starSin100) + Math.imul(y, starCos100) >> FP_BITS_3)
            if (xs >= 0 && xs < 160 && ys >= 0 && ys < 120) {
                img.setPixel(xs, ys, this.starColor[i])
            }
        } 
        */           
        const screenDiagPixels = 100
        const starCos100 = Fx8(this.starCos * screenDiagPixels)
        const starSin100 = Fx8(this.starSin * screenDiagPixels)
        const starX0FP = Fx8(this.starX0 * 2)
        const starY0FP = Fx8(this.starY0 * 2)
        for (let i = 0; i < this.numStars; ++i) {
            const x = Fx.iadd(-1, Fx.frac2(Fx.add(this.starX[i], starX0FP)))
            const y = Fx.iadd(-1, Fx.frac2(Fx.add(this.starY[i], starY0FP)))
            //const y = ((Fx.add(this.starY[i], starY0FP) & FP_ONE_SQ_MASK) * 2 - FP_ONE_SQ
            const xs = 80 + Fx.toIntFloor(Fx.sub(Fx.mul(x, starCos100), Fx.mul(y, starSin100)))
            const ys = 60 + Fx.toIntFloor(Fx.add(Fx.mul(x, starSin100), Fx.mul(y, starCos100)))
            //const ys = 60 + (Math.imul(x, starSin100) + Math.imul(y, starCos100) >> FP_BITS_3)
            if (xs >= 0 && xs < 160 && ys >= 0 && ys < 120) {
                img.setPixel(xs, ys, this.starColor[i])
            }
        } 
        perfStarfield.end()
    }

    // Counterclockwise rotation around screen center by an angle in radians
    rotateZ(angleRadians: number) {
        this.starAngle += angleRadians
        this.starCos = Math.cos(this.starAngle)
        this.starSin = Math.sin(this.starAngle)
    }

    // Rotation around Y axis (horizontal shift)
    rotateY(angleRadians: number) {
        const starAngleShift = angleRadians * this.radiansToShift
        this.starX0 += this.starCos * starAngleShift
        this.starY0 -= this.starSin * starAngleShift
    }

    // Rotation around X axis (vertical shift)
    rotateX(angleRadians: number) {
        const starAngleShift = angleRadians * this.radiansToShift
        this.starX0 += this.starSin * starAngleShift
        this.starY0 += this.starCos * starAngleShift
    }
}

let isSetupScreen = true
let showFps = false
let useCockpit = true

// Layers of the overall scene, drawn in ascending z-layer order
const zLayerStarfield = 0
const zLayer3D = 1
const zLayerLaser = 2
const zLayerCockpit = 3
const zLayerReticle = 4
const zLayerRadar = 5
const zLayerSetup = 6
const zLayerDebug = 200

let overlaySprite: Sprite

// Aiming reticle at the center of the screen. Also used for
// text message display.
let reticleSprite = sprites.create(assets.image`reticle`)
reticleSprite.z = zLayerReticle
reticleSprite.setPosition(80, 60)

// Configure the 3D renderer.
let renderer = new Renderer3d()
renderer.useFlatShading = false
renderer.setPaletteGrayscale()
renderer.setLightAngles(45, 30)

// Set the horizontal field of view for 3D rendering.
const horizontalFovDegrees: number = 90
let camera = new Camera3d(horizontalFovDegrees)

let lastTick = 0
let nextStatsTimestamp = 0
const baseSpeed = 0.1
const boostSpeed = baseSpeed * 3 // added to baseSpeed while boosting
const boostSustainFrames = 100
const boostReleaseFrames = 50
let boostActive = 0
let controlMode = 0
let stickRoll = false
let accelerometerRoll = false
let accelerometerPitch = false
let accelerometerYaw = false
let controlInvertY = true
let controlAnalogStick = true

// Start out with the laser set to having just been fired, this avoids
// a stray shot when starting the game with the A button.
let firing = 0
let laserPowerPerShot = 20
let laserPowerMax = 256
let laserPower = laserPowerMax
let laserGaugeWidthMax = 94
let laserGaugeMultiplierFP = Math.ceil(laserGaugeWidthMax * FP_ONE / laserPowerMax)
let laserOverheatingPlayed = false

let waveNum = 0
let nextWaveNum = 0
let nextWaveCountdown = 0

// Size in each axis direction of the observable universe.
const worldSizes = [40, 50, 100, 30]
const worldSizeDescriptions = ["medium", "large", "huge", "small"]
let worldSize = worldSizes[0]

const starCounts = [100, 200, 400, 800, 50]
let starCount = starCounts[0]

let icoModel = new IcosahedronModel()
let asteroids: AsteroidInstance[] = []

let collisionsEnabled = true
//let buttonMoveOnly = true
let buttonMoveOnly = false

let needsWaveReset = false
const preGameSetup = function() {
    if (needsWaveReset) {
        asteroids = []
        waveNum = nextWaveNum
        nextWaveNum = 0
        needsWaveReset = false
    }
}

const spawnAsteroids = function() {
    /*
    shipInstance = new ShipInstance(0, 0, worldSize)
    shipInstance.worldFromModel[9] = 4 << FP_BITS
    shipInstance.worldFromModel[10] = -2 << FP_BITS
    shipInstance.worldFromModel[11] = -10 << FP_BITS
    */

    asteroids = []
    let icoCount = 6 + waveNum * 2
    // Don't exceed the 256-priority-level limit, leaving some spares.
    if (icoCount > 250) icoCount = 250
    for (let i = 0; i < icoCount; ++i) {
        asteroids.push(new AsteroidInstance(waveNum, i, worldSize))
    }
}

let radar = new Radar(camera)
scene.createRenderable(zLayerRadar, function(img: Image, sceneCamera: scene.Camera) {
    radar.draw(img, sceneCamera, asteroids, worldSize, isSetupScreen, useCockpit)
})

let starfield = new Starfield(camera, starCount)
scene.createRenderable(zLayerStarfield, function(img: Image, unused_sceneCamera: scene.Camera) {
    starfield.draw(img)
})

// Rotation control sensitivity, degrees per target frame.
// This is scaled below based on framerate.
const rotAngleDegPerFrame = 2
let yawRate = 1
let rollRate = 1
let pitchRate = 1

let soundZap = new music.Melody("~16 @10,490,0,0 !1600,500^1")
let soundOverheated = new music.Melody("~16 @10,490,0,0 !800,500^700")
let soundBoom = new music.Melody("~4 @10,990,0,1 !400,1")
let soundExploded = new music.Melody("~4 @10,1990,0,1 !300,1")
let soundNextWave = new music.Melody("~16 R:4-100 E3 F E F E F")
let soundBoost = new music.Melody("~18 @25,25,200," + boostReleaseFrames * 20 + " !200," + boostSustainFrames * 20)

const cleanUpResources = function() {
    renderer.freeResources()

    // Destroy the asteroid instances and other large objects. Careful,
    // objects used in scene.createRenderable()-registered functions
    // must remain valid. (Zero asteroids is OK, asteroids=null would not be.)
    asteroids = []
    if (overlaySprite) overlaySprite.destroy()
    overlaySprite = null
    control.gc()
}

info.setLife(3)
info.onLifeZero(function() {
    cleanUpResources()
    pause(250)
    // TODO: see if a scene change can avoid error 021 (too many objects) on meowbit?
    //game.pushScene()
    game.over(false)
    //game.popScene()
})

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

const viewerPose: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]
const shipFrameMovement: number[] = [0, 0, 0]
const shipFrameMovementFx8: Fx8[] = [Fx.zeroFx8, Fx.zeroFx8, Fx.zeroFx8]

// Apply a rotation to the viewer pose matrix using the specified columns.
const rotateColumns = function(angle: number, a: number, b: number) {
        let s = Math.sin(angle)
        let c = Math.cos(angle)
        let ox = viewerPose[a]
        let oy = viewerPose[a + 1]
        let oz = viewerPose[a + 2]
        viewerPose[a] = viewerPose[a] * c + viewerPose[b] * s
        viewerPose[a + 1] = viewerPose[a + 1] * c + viewerPose[b + 1] * s
        viewerPose[a + 2] = viewerPose[a + 2] * c + viewerPose[b + 2] * s
        viewerPose[b] = -ox * s + viewerPose[b] * c
        viewerPose[b + 1] = -oy * s + viewerPose[b + 1] * c
        viewerPose[b + 2] = -oz * s + viewerPose[b + 2] * c
}
const rotateX = function(angle: number) {
    rotateColumns(angle, 3, 6)
}
const rotateY = function(angle: number) {
    rotateColumns(angle, 6, 0)
}
const rotateZ = function(angle: number) {
    rotateColumns(angle, 0, 3)
}

const startNextWaveIfAllDestroyed = function() {
    if (!nextWaveCountdown && !asteroids.length) {
        // All asteroids just got destroyed.

        // Do a garbage collection now to reduce hiccups during gameplay
        control.gc()
        ++waveNum
        reticleSprite.say("Wave " + (waveNum + 1), 2500)
        soundNextWave.play(100)
        nextWaveCountdown = 200
    }
}

const shootLaser = function() {
    if (laserPower < laserPowerPerShot) {
        if (!laserOverheatingPlayed) {
            soundOverheated.play(50)
            laserOverheatingPlayed = true
        }
        return
    } else {
        laserOverheatingPlayed = false
    }
    firing = 8
    laserPower -= laserPowerPerShot
    soundZap.play(50)

    // Don't check for hits if there are no targets. This avoids triggering
    // the next wave countdown multiple times.
    let hitTarget = false
    for (let i = asteroids.length - 1; i >= 0; --i) {
        const x = asteroids[i].getX()
        const y = asteroids[i].getY()
        const z = asteroids[i].getZ()
        const d2 = Math.imul(x, x) + Math.imul(y, y) >> FP_ONE
        const r_squared = 4 << FP_BITS_SQ
        if (d2 < r_squared && z < 0) {
            reticleSprite.startEffect(particleExplode, 100)
            soundBoom.play(100)
            asteroids.splice(i, 1)
            info.player1.changeScoreBy(1)
            hitTarget = true
            break
        }
    }
    if (hitTarget) {
        startNextWaveIfAllDestroyed()
    }

}

const volumes = [64, 128, 255, 0, 8, 16, 32]

const pieceCounts = [4, 8, 16, 32, 0]

// Prefix used for saving settings persistently
const settingPrefix = "spacerocks3d_"

// The menu entries and row count are set up below.
let setupMenu: (number | string | Function)[][] = []
let setupRowCount: number = 0
let setupValues: number[] = []
let setupDisplay: string[] = []
let setupRow = 0

const saveSetupSettings = function() {
    for (let i = 0; i < setupMenu.length; ++i) {
        const settingName = setupMenu[i][1]
        // Skip rows with no key name, including the "start game" setting which must not be persisted.
        if (!settingName) continue
        const value = setupValues[i]
        // No need to save values that are at their default value.
        // Remove legacy default config entries if present.
        let oldValue = settings.readNumber(settingPrefix + settingName)
        if (value == 0) {
            if (oldValue) settings.remove(settingPrefix + settingName)
            continue
        }
        // Don't write a value identical to the currently-stored one.
        if (value == oldValue) continue
        settings.writeNumber(settingPrefix + settingName, setupValues[i])
    }
}

const setupVolume = function(choice: number) {
    music.setVolume(volumes[choice])
    return "Sound volume: " + volumes[choice]
}

const setupShowFPS = function(choice: number) {
    showFps = choice ? true : false
    return "Show FPS: " + (showFps ? "on" : "off")
}

const setupRenderMode = function(choice: number) {
    renderer.useFlatShading = choice ? true : false
    return "Shading mode: " + (renderer.useFlatShading ? "flat" : "dithered")
}

const setupCockpitMode = function(choice: number) {
    // Use true for default choice=0
    useCockpit = choice ? false : true

    if (useCockpit) {
        overlaySprite = sprites.create(assets.image`cockpit3`)
        // The default position is what we want, so no need to
        // move it. Set the Z order to occlude explosions which
        // are at the reticle sprite's z=1. The radar image is 
        // at z=3 so that it's in front of the cockpit.
        overlaySprite.z = zLayerCockpit
    } else {
        if (overlaySprite) overlaySprite.destroy()
        overlaySprite = null
    }

    return "Cockpit overlay: " + (useCockpit ? "on" : "off")
}

const setupAnalogStick = function(choice: number) {
    // Use true for default choice=0
    controlAnalogStick = choice ? false : true
    return "Analog joystick: " + (controlAnalogStick ? "on" : "off")
}


const setupWorldSize = function(choice: number, loading: boolean=false) {
    worldSize = worldSizes[choice]
    if (!loading) {
        nextWaveNum = waveNum
        needsWaveReset = true
    }
    return "World size: " + worldSizeDescriptions[choice]
}

const setupStarCount = function(choice: number) {
    starCount = starCounts[choice]
    starfield = new Starfield(camera, starCount)
    return "Number of stars: " + starCount
}

const setupStartingWave = function(waveChoice: number) {
    // Allow directly changing waves if score is still zero.
    const isNewGame = (info.player1.score() == 0)
    // Internal wave numbers start at zero, add one for screen display
    if (isNewGame) {
        nextWaveNum = waveChoice
        needsWaveReset = true
        return "Start at wave: " + (waveChoice + 1)
    }

    // Not a new game. Allow skipping waves, but not going backwards.
    if (waveChoice > waveNum) {
        nextWaveNum = waveChoice
        needsWaveReset = true
        return "Skip ahead to wave: " + (waveChoice + 1)
    } else {
        return "Start next game at wave: " + (waveChoice + 1)
    }
}

const setupStartGame = function(choice: number, loading: boolean=false) {
    if (!loading) {
        saveSetupSettings()

        isSetupScreen = false

        preGameSetup()

        if (controller.A.isPressed()) {
            // Start out with the laser set to having just been fired, this avoids
            // a stray shot sound when starting the game with the A button.
            let firing = 10
        }
    }
    return "Start Game"
}

const setupResetGame = function(choice: number, loading: boolean=false) {
    if (!loading) {
        saveSetupSettings()
        game.reset()
    }
    return "Reset game"
}

const setupEnableTrace = function(choice: number, loading: boolean=false) {
    if (!loading) {
        if (simpleperf.isEnabled) {
            simpleperf.disableAndShowResults()
        } else {
            simpleperf.enable()
        }
    }
    return simpleperf.isEnabled ? "Show trace results" : "Enable perf tracing"
}

const showSystemMenu = function(choice: number, loading: boolean=false) {
    if (!loading) {
        scene.systemMenu.showSystemMenu()
    }
    return "Open system menu"
}

const setupInvertY = function(choice: number, loading: boolean=false) {
   // Use true for default choice=0    
    controlInvertY = choice ? false : true

    return "Joystick Y: " + (controlInvertY ? "inverted" : "normal")
}

const setupControls = function(controlMode: number) {
    const controls = "Controls: "
    stickRoll = false
    accelerometerYaw = false
    accelerometerRoll = false
    accelerometerPitch = false
    switch (controlMode) {
        case 0:
            yawRate = 1
            rollRate = 1
            pitchRate = 1
            return controls + "Stick yaw/pitch"
        case 1:
            stickRoll = true
            yawRate = 1
            rollRate = 2
            pitchRate = 1.4
            return controls + "Stick roll/pitch"
        case 2:
            accelerometerRoll = true
            yawRate = 0.7
            rollRate = 1.4
            pitchRate = 1.4
            return controls + "Tilt roll"
        case 3:
            accelerometerRoll = true
            accelerometerPitch = true
            yawRate = 0.7
            rollRate = 1.4
            pitchRate = 1.4
            return controls + "Tilt roll/pitch"
        case 4:
            stickRoll = true
            accelerometerYaw = true
            accelerometerPitch = true
            yawRate = 0.7
            rollRate = 1.4
            pitchRate = 1.4
            return controls + "Tilt yaw/pitch"
    }
    return ""
}

// Each menu item has:
// - the number of choices available
// - the name (after settingPrefix) used for saving. Empty string means don't save.
// - the function to be called when a setting is changed. 
//
// Entries with a single choice are intended for actions that take effect immediately when selected.
setupMenu = [
    [1, "", setupStartGame],
    [20, "startingWave", setupStartingWave],
    [volumes.length, "setupVolume", setupVolume],
    [worldSizes.length, "worldSize", setupWorldSize],
    [5, "controlScheme", setupControls],
    [2, "analogStick", setupAnalogStick],
    [2, "invertY", setupInvertY],
    [2, "useCockpit", setupCockpitMode],
    [starCounts.length, "starCount", setupStarCount],
    //[2, "useDither", setupRenderMode],
    [2, "showFps", setupShowFPS],
    [1, "", setupEnableTrace],
    [1, "", setupResetGame],
    [1, "", showSystemMenu],
]
setupRowCount = setupMenu.length
for (let i = 0; i < setupMenu.length; ++i) {
    let initialValue = 0
    const settingName = setupMenu[i][1]
    if (settingName && settings.exists(settingPrefix + settingName)) {
        initialValue = settings.readNumber(settingPrefix + settingName)   
        //console.log("saved value for " + settingName + " is " + initialValue) 

        // Check for invalid settings and remove them. This includes a setting with
        // value zero, that's the default and doesn't need to be saved.
        if (initialValue <= 0 || initialValue >= setupMenu[i][0] || initialValue != Math.floor(initialValue)) {
            console.log("saved value " + initialValue + " for " + settingName + " invalid, using default") 
            initialValue = 0
            settings.remove(settingPrefix + settingName)
        }
    }
    let setupFunc = setupMenu[i][2] as Function
    let initialDisplay = ""

    // It's possible that the saved setting isn't usable and causes a
    // runtime error. In that case, delete the setting and try again
    // with the default value.
    try {
        initialDisplay = setupFunc(initialValue, true)
        if (!initialDisplay) {
            console.log("Loading setting " + settingName + " rejected, using default")
            initialValue = 0
            initialDisplay = setupFunc(initialValue, true)
        }
    } catch(err) {
        console.log("Loading setting " + settingName + " failed: " + err)
        settings.remove(settingPrefix + settingName)
        initialValue = 0
        initialDisplay = setupFunc(initialValue, true)
    }
    setupValues.push(initialValue)
    setupDisplay.push(initialDisplay)
}

controller.down.onEvent(ControllerButtonEvent.Pressed, function() {
    if (!isSetupScreen) return
    setupRow = (setupRow + 1) % setupRowCount
})

controller.up.onEvent(ControllerButtonEvent.Pressed, function() {
    if (!isSetupScreen) return
    setupRow = (setupRow + setupRowCount - 1) % setupRowCount
})

const setupChangeEntry = function(change: number) {
    if (!isSetupScreen) return

    let menu = setupMenu[setupRow]
    let numValues = menu[0] as number
    let setupFunc = menu[2] as Function
    setupValues[setupRow] = (setupValues[setupRow] + numValues + change) % numValues
    setupDisplay[setupRow] = setupFunc(setupValues[setupRow])

}
const setupNextEntry = function() {
    setupChangeEntry(1)
}
const setupPrevEntry = function() {
    setupChangeEntry(-1)
}
controller.A.onEvent(ControllerButtonEvent.Pressed, setupNextEntry)
controller.right.onEvent(ControllerButtonEvent.Pressed, setupNextEntry)
controller.right.onEvent(ControllerButtonEvent.Repeated, setupNextEntry)
controller.left.onEvent(ControllerButtonEvent.Pressed, setupPrevEntry)
controller.left.onEvent(ControllerButtonEvent.Repeated, setupPrevEntry)

controller.menu.onEvent(ControllerButtonEvent.Pressed, function() {
    if (isSetupScreen) {
        // Treat this as fully equivalent to using the "Start game" function
        setupStartGame(0, false)
    } else {
        setupDisplay[0] = "Continue Game"
        isSetupScreen = true
    }
})

// Set up the initial asteroid state.
spawnAsteroids()

const perfSetupMenu = simpleperf.getCounter("menu")
scene.createRenderable(zLayerSetup, function(img: Image, unused_sceneCamera: scene.Camera) {
    if (!isSetupScreen) return

    perfSetupMenu.start()
    //game.splash("Space Rocks 3D!", "A: fire, B: configure controls")
    img.printCenter("Space Rocks 3D!", 7, 6, image.font8)
    img.printCenter("Space Rocks 3D!", 6, 15, image.font8)

    img.printCenter("Press A to fire laser", 22, 15)
    img.printCenter("Press B to boost speed", 32, 15)

    let y = 50
    const maxRows = 7
    const firstRow = Math.max(0, setupRow + 1 - maxRows)
    if (firstRow > 0) {
        img.print("↑", 0, y, 12, image.font8)
        img.print("↑", 155, y, 12, image.font8)
    }
    for (let i = 0; i < maxRows; ++i) {
        const row = firstRow + i
        if (row >= setupRowCount) break
        if (row == setupRow) {
            img.fillRect(0, y - 1, 160, 10, 6)
            img.drawRect(0, y - 1, 160, 10, 10)
        }
        img.printCenter(setupDisplay[row], y + 1, 2)
        img.printCenter(setupDisplay[row], y, row == setupRow ? 15 : 10)
        y += 10
    }
    if (firstRow + maxRows < setupRowCount) {
        const y2 = y - 10
        img.print("↓", 0, y2, 12, image.font8)
        img.print("↓", 155, y2, 12, image.font8)
    }
    perfSetupMenu.end()
})

const perfLayer3D = simpleperf.getCounter("layer3d")
const perfLayer3DSort = simpleperf.getCounter("layer3dsort")

function drawLayer3D(target: Image, unused_sceneCamera: scene.Camera) {
    perfLayer3D.start()
    // Sort the instances by increasing Z in viewer space (+z faces viewer)
    perfLayer3DSort.start()
    asteroids.sort((a, b) => a.getZ() - b.getZ())
    perfLayer3DSort.end()
    /*
    const baseShader = shader3d.getHalfAngleDiffuseShader(renderer.lightDirection, 0, 52)
    const shader = shader3d.applyDistanceDimming(baseShader, worldSize << FP_BITS, 8)
    */
    const baseShader = shader3d.getHalfAngleDiffuseShader(renderer.lightDirection, 4, 60)
    const shader = shader3d.applyDistanceDimming(baseShader, worldSize << FP_BITS, 0)
    for (let i = 0; i < asteroids.length; ++i) {
        // With the objects sorted back to front, add each one's face polygons
        // to the drawing queue for this frame.
        icoModel.drawInstance(renderer, camera, shader, asteroids[i])
    }

    renderer.drawFrame(target)
    perfLayer3D.end()
}
scene.createRenderable(zLayer3D, drawLayer3D)

scene.createRenderable(zLayerLaser, function(target: Image, sceneCamera: scene.Camera) {
    // Update the cockpit user interface
    let laserGaugeSize = Math.imul(laserPower, laserGaugeMultiplierFP) >> FP_BITS

    // Don't show a filled laser gauge on the setup screen, it's too bright.
    if (isSetupScreen) laserGaugeSize = 0

    if (useCockpit) {
        let shakeX = -sceneCamera.drawOffsetX
        let shakeY = -sceneCamera.drawOffsetY

        target.drawRect(33 + shakeX, 82 + shakeY, laserGaugeSize, 2, 15)
        target.drawRect(33 + shakeX + laserGaugeSize, 82 + shakeY, laserGaugeWidthMax - laserGaugeSize, 2, 4)
    } else {
        target.drawRect(0, 120 - laserGaugeSize, 2, laserGaugeSize, 15)
    }    
})

scene.createRenderable(zLayerLaser, function(target: Image, sceneCamera: scene.Camera) {
    if (firing > 3) {
        let shakeX = -sceneCamera.drawOffsetX
        let shakeY = -sceneCamera.drawOffsetY
        // Don't offset the far point of the laser, that isn't affected by screen shake.
        target.drawLine(60 + shakeX, 119 + shakeY, 80, 60, 15)
        target.drawLine(100 + shakeX, 119 + shakeY, 80, 60, 15)
    }
})

let statsFrameCounter = 0
let statsLastFps = 0
scene.createRenderable(zLayerDebug, function(img: Image, unused_sceneCamera: scene.Camera) {
    if (!showFps) return;

    ++statsFrameCounter

    const now = control.millis()
    if (now >= nextStatsTimestamp) {
        statsLastFps = statsFrameCounter
        statsFrameCounter = 0

        nextStatsTimestamp += 1000
        // If we're way behind schedule, advance the time counter
        if (nextStatsTimestamp <= now) nextStatsTimestamp = now + 1000
    }

    img.print("" + statsLastFps, 74, 0, 12)
})

const perfUpdateScene = simpleperf.getCounter("updateScene")

const updateScene = function(multiplierFloat: number, shipFrameMovementFx8: Fx8[]) {
    perfUpdateScene.start()
    renderer.setViewerPose(viewerPose)
    renderer.prepareFrame()

    const multiplier = Fx8(multiplierFloat)
    for (let i = 0; i < asteroids.length; ++i) {
        asteroids[i].updateWorldFromModel(multiplier, shipFrameMovementFx8, isSetupScreen)
        asteroids[i].preRender(renderer)
    }

    perfUpdateScene.end()
}

/*
rotateZ(-Math.PI / 2)
rotateX(0 * Math.PI / 180)
rotateY(-30 * Math.PI / 180)
*/

const perfUpdate = simpleperf.getCounter("update")

const doUpdate = function() {
    perfUpdate.start()
    let tick = game.runtime()

    let multiplier = 1
    if (lastTick) {
        const lastFrameDeltaMillis = tick - lastTick
        const targetMillis = 20 // 50 fps => 20ms per frame
        multiplier = Math.constrain(lastFrameDeltaMillis / targetMillis, 1, 5)
    }
    lastTick = tick

    if (isSetupScreen) {
        updateScene(multiplier, [Fx.zeroFx8, Fx.zeroFx8, Fx.zeroFx8])
        perfUpdate.end()
        return
    }

    let rotAngle = multiplier * rotAngleDegPerFrame * Math.PI / 180
    const pitchRateDirection = controlInvertY ? -pitchRate : pitchRate

    let stickX = 0
    let stickY = 0
    if (controlAnalogStick) {
        stickX = (controller.left.pressureLevel() - controller.right.pressureLevel()) / 512
        stickY = (controller.up.pressureLevel() - controller.down.pressureLevel()) / 512
    } else {
        if (controller.left.isPressed()) stickX = 1
        if (controller.right.isPressed()) stickX = -1
        if (controller.up.isPressed()) stickY = 1
        if (controller.down.isPressed()) stickY = -1
    }
    if (stickX != 0) {
        if (stickRoll) {
            rotateZ(stickX * rotAngle * rollRate)
            starfield.rotateZ(stickX * rotAngle * rollRate)
        } else {
            rotateY(stickX * rotAngle * yawRate)
            starfield.rotateY(stickX * rotAngle * yawRate)
        }
    }
    if (stickY != 0) {
        rotateX(stickY * rotAngle * pitchRateDirection)
        starfield.rotateX(stickY * rotAngle * pitchRateDirection)        
    }
    /*
    if (controller.right.isPressed()) {
        if (stickRoll) {
            rotateZ(-rotAngle * rollRate)
            starfield.rotateZ(-rotAngle * rollRate)
        } else {
            rotateY(-rotAngle * yawRate)
            starfield.rotateY(-rotAngle * yawRate)
        }
    }
    if (controller.up.isPressed()) {
        rotateX(rotAngle * pitchRateDirection)
        starfield.rotateX(rotAngle * pitchRateDirection)
    }
    if (controller.down.isPressed()) {
        rotateX(-rotAngle * pitchRateDirection)
        starfield.rotateX(-rotAngle * pitchRateDirection)
    }
    */

    // The ship's movement this frame is -speed * orientation.z
    // (-z is forward).

    let speed = baseSpeed
    if (buttonMoveOnly) {
        speed = controller.B.isPressed() ? baseSpeed : 0
    } else {
        // Boost runs for active + release time, and can be re-triggered
        // during the release time.
        if (controller.B.isPressed() && boostActive < boostReleaseFrames) {
            boostActive = boostSustainFrames + boostReleaseFrames
            soundBoost.play(100)
        }
        if (boostActive > boostReleaseFrames) {
            speed += boostSpeed
        } else if (boostActive > 0) {
            speed += Math.floor(boostSpeed * boostActive / boostReleaseFrames)
        }
        //let speed = boostActive > 0 ? boostSpeed : baseSpeed
        boostActive -= multiplier
        if (boostActive < 0) boostActive = 0
    }

    shipFrameMovement[0] = -viewerPose[6] * speed * multiplier
    shipFrameMovement[1] = -viewerPose[7] * speed * multiplier
    shipFrameMovement[2] = -viewerPose[8] * speed * multiplier

    if (accelerometerRoll || accelerometerYaw) {
        const accel = [
            controller.acceleration(ControllerDimension.X) / 1000,
            controller.acceleration(ControllerDimension.Y) / 1000,
            controller.acceleration(ControllerDimension.Z) / 1000]
        if (accelerometerRoll) {
            const rollAngle = -accel[0] / 10
            rotateZ(rollAngle)
            starfield.rotateZ(rollAngle)
        }
        if (accelerometerYaw) {
            const yawAngle = -accel[0] / 10
            rotateY(yawAngle)
            starfield.rotateY(yawAngle)
        }
        if (accelerometerPitch) {
            // Z movement based on 45-degree neutral angle: viewer[2] += accel[1] + accel[2]
            const pitchAccel = (accel[1] + accel[2]) * 2
            rotateX(-rotAngle * pitchRateDirection * pitchAccel)
            starfield.rotateX(-rotAngle * pitchRateDirection * pitchAccel)
        }
    }

    /*
    viewerPose[9] += shipFrameMovement[0]
    viewerPose[10] += shipFrameMovement[1]
    viewerPose[11] += shipFrameMovement[2]
    vec_convert_to_FP(shipFrameMovementFP, [0, 0, 0])
    */
    //console.log("at " + viewerPose[9] + ", " + viewerPose[10] + ", " + viewerPose[11])

    vec_convert_to_Fx8(shipFrameMovementFx8, shipFrameMovement)

    updateScene(multiplier, shipFrameMovementFx8)

    // Check for crashing into an asteroid
    let shipDestroyed = false
    for (let i = asteroids.length - 1; i >= 0; --i) {
        const x = asteroids[i].getX()
        const y = asteroids[i].getY()
        const z = asteroids[i].getZ()
        const d2 = Math.imul(x, x) + Math.imul(y, y) + Math.imul(z, z) >> FP_ONE
        // The asteroid radius is 2 units, or 4 when squared. Use a slightly
        // larger radius when checking for collisions to simulate that the ship
        // extends outwards a bit also.
        const r_squared = 5 << FP_BITS_SQ
        if (collisionsEnabled && d2 < r_squared) {
            soundExploded.play(200)
            info.changeLifeBy(-1)
            asteroids.splice(i, 1)
            scene.cameraShake(8, 800)
            shipDestroyed = true
            break
        }
    }
    if (shipDestroyed) {
        startNextWaveIfAllDestroyed()
    }

    if (controller.A.isPressed() && !firing) {
        shootLaser()
    }
    if (!firing) {
        laserPower = Math.min(laserPowerMax, laserPower + multiplier)
    }
    if (firing) {
        firing -= multiplier
        if (firing < 0) firing = 0
    } else if (nextWaveCountdown) {
        nextWaveCountdown -= multiplier
        if (nextWaveCountdown < 0) nextWaveCountdown = 0
    } else {
        if (!asteroids.length /* && !shipInstance */) {
            spawnAsteroids()
        }
    }
    perfUpdate.end()
}

game.onUpdate(doUpdate)
