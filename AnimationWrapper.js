import * as THREE from 'three';
import URDFViewer from 'urdf-loader';
import URDFLoader from 'urdf-loader/src/URDFLoader.js';


export default
    class AnimationWrapper extends URDFViewer {

    constructor() {

        super();

        // removed shader bug https://github.com/mrdoob/three.js/issues/9716
        this.renderer.context.getShaderInfoLog = function () { return ''; };

        if (typeof this.urdfLoader === "undefined") {
            // URDF-loader version after 0.6.0
            this.loadMeshFunc = (path, manager, done) => {
                new URDFLoader(manager).defaultMeshLoader(path, manager, obj => {
                    for (let i = obj.children.length - 1; i >= 0; i--) {

                        if (obj.children[i].type !== 'Mesh') {
                            obj.remove(obj.children[i]);
                        }
                    }

                    done(obj);
                });
            };
        }
        else {
            // URDF-loader version before 0.6.0
            const meshOnlyLoader_ = this.urdfLoader.defaultMeshLoader.bind(this.urdfLoader);
            this.urdfLoader.defaultMeshLoader = (path, ext, done) => {

                meshOnlyLoader_(path, ext, obj => {
                    for (let i = obj.children.length - 1; i >= 0; i--) {

                        if (obj.children[i].type !== 'Mesh') {
                            obj.remove(obj.children[i]);
                        }
                    }
                    done(obj);
                });
            };
        }

        this.clock = new THREE.Clock();

        this.controls.enablePan = true;
        this.controls.enableDamping = true; // an animation loop is required when either damping or auto-rotation are enabled
        this.controls.dampingFactor = 0.25;
        this.controls.screenSpacePanning = false;
        this.controls.maxPolarAngle = Math.PI / 2;
        // this.controls.removeEventListener('change', () => this.recenter());


    }

    _setRecorder(quality, speed) {
        this.action.reset();
        this.mixer.update(this.clock.getDelta()); // Jump to first frame before record
        this.gif.abort();
        this.gif.width = null;
        this.gif.height = null;
        this.gif.frames = []; // Remove previous recorded frames
        this.gif.setOptions({
            quality: quality,
            width: this.canvas.width,
            height: this.canvas.height
        });
        this.mixer.timeScale = speed;
        this.action.paused = false;
    }


    renderLoop() {
        requestAnimationFrame(this.renderLoop.bind(this));
        this.mixer.update(this.clock.getDelta());
        if (this.recording) {
            this.gif.addFrame(this.canvas, { delay: this.delay, copy: true });
            this.updateRecordBar();
        }
    }

    _addGIFConverterGUI() {
        if (this.gui == null) this.gui = new dat.GUI();
        this.gif.on('progress', p => gifAPI['converting ='] = p * 100);
        this.mixer.addEventListener('loop', () => {
            if (this.recording) {
                this.recording = false;
                this.action.paused = true;
                this.gif.render();
            }
        });
        this.updateRecordBar = () => gifAPI['recording ='] = this.action.time;
        let folder = this.gui.addFolder('Record ' + this.track.name),
            gifAPI = {
                'record()': () => {
                    this._setRecorder(gifAPI.quality, gifAPI.speed);
                    gifAPI['recording ='] = 0;
                    gifAPI['converting ='] = 0;
                    this.recording = true;
                },
                'recording =': 0,
                'converting =': 0,
                speed: 1,
                quality: 10
            };

        folder.add(gifAPI, 'speed', 0.1, 10);
        folder.add(gifAPI, 'quality', 1, 10, 1);
        folder.add(gifAPI, 'record()');
        let rec = folder.add(gifAPI, 'recording =', 0, this.track.duration).listen();
        let conv = folder.add(gifAPI, 'converting =', 0, 100).listen();
        rec.domElement.style.pointerEvents = 'none';
        conv.domElement.style.pointerEvents = 'none';
    }

    setCamera(data) {

        this.camera.fov = data.fov;
        this.camera.position.set(...data.position);
    }

    setLight(data) {

        this.directionalLight.position.set(...data.position);
        this.directionalLight.shadow.bias = data.shadow.bias;
        this.directionalLight.shadow.mapSize.width = data.shadow.mapSize.width;
        this.directionalLight.shadow.mapSize.height = data.shadow.mapSize.width;
    }


    addURDF(data) {

        this.setUrdf = (urdf) => {
            super.urdf = urdf;
        };

        if (Object.prototype.toString.call(data.urdfPkgs) === '[object String]')

            new THREE.FileLoader().load(data.urdfPkgs, pkgs => {
                super.package = parseRosinstall(pkgs);
                this.setUrdf(data.urdf); // once the packages are parsed
            });

        else {
            let pkgs = data.urdfPkgs || [];
            super.package = pkgs.join(', ');
            this.setUrdf(data.urdf);
        }

    }


    addAnimation(data) {

        this.addEventListener('geometry-loaded', () => {

            new THREE.FileLoader().load(data.animation, anim => {
                // Load recorded robot motion into a Three.js clipAction
                const fading = data.fading || 0.0;
                const controlGUI = data.controlGUI | false;
                const loopOnce = data.loopOnce | false;

                this.mixer = new THREE.AnimationMixer(this.world);
                this.track = THREE.AnimationClip.parse(JSON.parse(anim));
                this.action = this.mixer.clipAction(this.track);
                this.action.fadeIn(fading).play();
                if (loopOnce) {
                    this.action.setLoop(THREE.LoopOnce);
                    this.action.clampWhenFinished = true;
                }
                if (this.gui == null) this.gui = new dat.GUI();
                if (controlGUI) addControlGUI(this.gui, this.action, this.track, fading);

                this.dispatchEvent(new CustomEvent('animation-loaded', { bubbles: true, cancelable: true, composed: true }));
                this.renderLoop();
            });
        }, { once: true });
    }

    addGIFConverter(data) {
        this.addEventListener('animation-loaded', () => {

            this.canvas = document.getElementsByTagName('canvas')[0];

            this.gif = new GIF({    // https://github.com/jnordberg/gif.js
                repeat: data.repeate || 0,  // 1 = no repeat, 0 = forever
                workers: data.workers || 2,
                workerScript: data.workerScript || 'gif.worker.js',
                background: data.background || '#fff',
                transparent: this.transparent || null, // hex color, 0x00FF00 = green
                dither: data.dither || false, // e.g. FloydSteinberg-serpentine
                debug: data.debug || false,
            });
            this.gif.on('finished', blob => window.open(URL.createObjectURL(blob)));

            this.delay = data.delay || 500;
            this.renderer.setClearColor(0xffffff); //white bg for recorded gif

            this._addGIFConverterGUI();
        });// TODO check if "once" is better
    }

    addWorld(data) {

        const urdf = data.urdf;
        const pkgs = data.packagesContainingMeshes.join(', ') || '';

        this.urdfLoader.load(urdf, pkgs,
            obj => {
                obj.traverse(c => {
                    if (c.type === 'Mesh') {
                        c.castShadow = true;
                        c.receiveShadow = true;
                    }
                });
                this.scene.add(obj);
            }
        );
    }
}


function addControlGUI(gui, action, track, fading) {
    // modified code of https://threejs.org/examples/#webgl_animation_skinning_morph
    let folder = gui.addFolder('Control ' + track.name),
        API = {
            'play()': () => action.play(),
            'stop()': () => action.stop(),
            'reset()': () => action.reset(),
            get 'time ='() { return action !== null ? action.time : 0; },
            set 'time ='(value) { action.time = value; },
            get 'paused ='() { return action !== null && action.paused; },
            set 'paused ='(value) { action.paused = value; },
            get 'enabled ='() { return action !== null && action.enabled; },
            'fade in()': () => action.reset().fadeIn(fading).play()
        };

    folder.add(API, 'play()');
    folder.add(API, 'stop()');
    folder.add(API, 'reset()');
    folder.add(API, 'time =', 0, track.duration).listen();
    folder.add(API, 'paused =').listen();
    folder.add(API, 'fade in()');
}

function parseRosinstall(pkgs) {

    function gitraw(uri) {
        const base = 'https://raw.githubusercontent.com/';
        const repo = uri.split('https://github.com/')[1].split('.git')[0];
        return base + repo;
    }

    //Hardcoded for git
    function g(obj, key) { return obj['git'][key]; }
    let l = 'local-name', u = 'uri', v = 'version';

    return jsyaml.load(pkgs).map(i => `${g(i, l)}: ${gitraw(g(i, u))}/${g(i, v)}/${g(i, l)}`);

}

customElements.define('urdf-viewer', AnimationWrapper);
