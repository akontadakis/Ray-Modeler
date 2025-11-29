import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

console.log('THREE version:', THREE.REVISION);
console.log('OBJLoader loaded:', !!OBJLoader);
console.log('MTLLoader loaded:', !!MTLLoader);
console.log('RGBELoader loaded:', !!RGBELoader);
