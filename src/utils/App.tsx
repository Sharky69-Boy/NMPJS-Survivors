// @ts-nocheck
import React, { useEffect, useRef } from 'react';

export function App() {
  const canvasRef = useRef(null);

  useEffect(() => {
    // --- CONFIGURATION & STATE ---
    const settings = {
        volume: 0.8,
        zoom: 1.0,
        particles: true,
        crtOpacity: 0.25,
        showText: true,
        showBars: true
    };

    const canvas = document.getElementById('gameCanvas');
    const ctx = canvas.getContext('2d');
    let state = 'start';
    let score = 0;
    let frames = 0;
    let lastTime = 0;
    let dt = 1;
    let hitStop = 0;
    let camera = { x: 0, y: 0, shake: 0 };
    let bossActive = false;

    // --- UNIVERSAL DIALOGUE SYSTEM ---
    const DialogueSys = {
        get ui() { return document.getElementById('dialogue-ui'); },
        get nameEl() { return document.getElementById('dialogue-name'); },
        get textEl() { return document.getElementById('dialogue-text'); },
        timer: null,
        active: false,

        say(name, lines) {
            if(this.timer) clearTimeout(this.timer);
            this.active = true;
            this.ui.style.display = 'block';
            this.nameEl.innerText = name;
            
            let index = 0;
            
            const showNext = () => {
                if(index >= lines.length) {
                    this.ui.style.display = 'none';
                    this.active = false;
                    return;
                }
                this.textEl.innerText = lines[index];
                index++;
                this.timer = setTimeout(showNext, 2500); 
            };
            showNext();
        }
    };

    // --- INPUT ---
    const input = { x: 0, y: 0 };
    const keys = {};
    const handleKeyDown = e => keys[e.key.toLowerCase()] = true;
    const handleKeyUp = e => keys[e.key.toLowerCase()] = false;
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // --- AUDIO SYSTEM ---
    const AudioSys = {
        ctx: null,
        init() { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); },
        play(freq, type, dur, vol, sweep=0) {
            if(!this.ctx) return;
            const osc = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            if(sweep) osc.frequency.exponentialRampToValueAtTime(freq + sweep, this.ctx.currentTime + dur);
            g.gain.setValueAtTime(vol * settings.volume, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            osc.connect(g); g.connect(this.ctx.destination);
            osc.start(); osc.stop(this.ctx.currentTime + dur);
        },
        shoot(w) {
            if(w==='blaster') this.play(600, 'square', 0.08, 0.04, -200);
            if(w==='missile') this.play(100, 'sine', 0.4, 0.08, 300);
            if(w==='shotgun') this.play(200, 'sawtooth', 0.15, 0.06, -100);
        },
        impact() { this.play(100, 'sawtooth', 0.08, 0.06); },
        xp() { this.play(1200, 'sine', 0.08, 0.04, 600); },
        lvl() { this.play(400, 'square', 0.2, 0.08, 800); }
    };

    // --- UTILS ---
    const getDist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
    const lerp = (a, b, t) => a + (b - a) * t;

    // --- ENTITY CLASSES ---
    class Player {
        constructor() {
            this.x = 0; this.y = 0;
            this.radius = 12;
            this.hp = 100; this.maxHp = 100;
            this.xp = 0; this.lvl = 1; this.nextXp = 25;
            this.weapon = 'blaster';
            this.timer = 0;
            this.invuln = 0;
            this.godMode = false;
            
            this.levels = { 
                dmg:0, spd:0, rate:0, hp:0, mag:0, reg:0, aoe:0, orb:0, crit:0,
                pierce:0, projSpd:0, size:0,
                multishot:0, ricochet:0, thorns:0, duration:0
            };
            this.refreshStats();
        }

        refreshStats() {
            this.speed = 4.5 + (this.levels.spd * 0.5);
            this.damage = 25 + (this.levels.dmg * 10);
            this.fireRate = Math.max(5, 20 - (this.levels.rate * 2));
            this.magnet = 120 + (this.levels.mag * 40);
            this.regen = this.levels.reg * 0.02;
            this.aoe = this.levels.aoe * 35;
            this.critChance = this.levels.crit * 0.1;
            this.pierceCount = this.levels.pierce;
            this.ricochetCount = this.levels.ricochet;
            this.projVelMult = 1 + (this.levels.projSpd * 0.2);
            this.projLifeMult = 1 + (this.levels.duration * 0.2);
            
            const oldMax = this.maxHp;
            this.maxHp = 100 + (this.levels.hp * 25);
            if(this.maxHp > oldMax) this.hp += (this.maxHp - oldMax);
            this.radius = 12 + (this.levels.size * 2);
            
            this.updateUI();
        }

        update() {
            let kx = 0, ky = 0;
            if(keys.w || keys.arrowup) ky -= 1;
            if(keys.s || keys.arrowdown) ky += 1;
            if(keys.a || keys.arrowleft) kx -= 1;
            if(keys.d || keys.arrowright) kx += 1;
            
            if(kx !== 0 || ky !== 0) {
                const mag = Math.hypot(kx, ky);
                input.x = kx/mag; input.y = ky/mag;
            } else if (!joyActive) {
                input.x = 0; input.y = 0;
            }

            this.x += input.x * this.speed * dt;
            this.y += input.y * this.speed * dt;

            if(this.hp < this.maxHp) this.hp = Math.min(this.maxHp, this.hp + this.regen * dt);
            if(this.invuln > 0) this.invuln -= dt;

            this.timer += dt;
            if(this.timer >= this.fireRate) this.shoot();
            this.updateOrbitals();
        }

        updateOrbitals() {
            if(this.levels.orb <= 0) return;
            const count = this.levels.orb;
            const orbitR = 60;
            const rotSpd = frames * 0.05;
            for(let i=0; i<count; i++) {
                const ang = rotSpd + (i * Math.PI * 2 / count);
                const ox = this.x + Math.cos(ang) * orbitR;
                const oy = this.y + Math.sin(ang) * orbitR;
                
                enemies.forEach(e => {
                    if(getDist(ox, oy, e.x, e.y) < e.radius + 14) {
                        e.takeDamage(this.damage * 0.2, 0.5);
                    }
                });
                ctx.fillStyle = 'rgba(52, 152, 219, 0.5)';
                ctx.beginPath(); ctx.arc(ox, oy, 6 + this.levels.size, 0, Math.PI*2); ctx.fill();
            }
        }

        shoot() {
            const target = this.getNearest();
            if(!target) return;
            this.timer = 0;
            AudioSys.shoot(this.weapon);
            camera.shake = 2;

            const ang = Math.atan2(target.y - this.y, target.x - this.x);
            const isCrit = Math.random() < this.critChance;
            const dmg = isCrit ? this.damage * 2 : this.damage;

            const shots = 1 + this.levels.multishot;

            if(this.weapon === 'shotgun') {
                for(let i=-1; i<=1; i++) {
                    this.spawnProj(ang + i*0.25, dmg, 6, isCrit);
                }
            } else {
                const spread = 0.15; 
                for(let i=0; i<shots; i++) {
                    const offset = (i - (shots-1)/2) * spread;
                    this.spawnProj(ang + offset, dmg, 10, isCrit);
                }
            }
        }

        spawnProj(ang, dmg, spd, crit, type='bullet') {
            projectiles.push(new Projectile(this.x, this.y, ang, dmg, spd, crit, type));
        }

        getNearest() {
            let n = null, d = Infinity;
            enemies.forEach(e => {
                const dist = getDist(this.x, this.y, e.x, e.y);
                if(dist < d) { d = dist; n = e; }
            });
            return n;
        }

        takeDamage(amt) {
            if(this.invuln > 0 || this.godMode) return;
            this.hp -= amt;
            this.invuln = 40;
            camera.shake = 10;
            const overlay = document.getElementById('damage-overlay');
            if(overlay) {
                overlay.style.opacity = '0.6';
                setTimeout(()=> overlay.style.opacity = '0', 150);
            }
            if(this.hp <= 0) gameOver();
            this.updateUI();
        }

        gainXp(amt) {
            this.xp += amt;
            AudioSys.xp();
            if(this.xp >= this.nextXp) {
                this.xp -= this.nextXp;
                this.lvl++;
                this.nextXp = Math.floor(this.nextXp * 1.3);
                this.refreshStats();
                showUpgradeMenu();
            }
            this.updateUI();
        }

        updateUI() {
            const hpBar = document.getElementById('hp-bar');
            const xpBar = document.getElementById('xp-bar');
            const lvlDisplay = document.getElementById('lvl-display');
            const scoreDisplay = document.getElementById('score-display');
            const weaponDisplay = document.getElementById('weapon-display');
            
            if(hpBar) hpBar.style.width = (this.hp/this.maxHp*100)+'%';
            if(xpBar) xpBar.style.width = (this.xp/this.nextXp*100)+'%';
            if(lvlDisplay) lvlDisplay.innerText = this.lvl;
            if(scoreDisplay) scoreDisplay.innerText = score.toString().padStart(6, '0');
            if(weaponDisplay) weaponDisplay.innerText = `MOD: ${this.weapon}`;
        }

        draw() {
            if(this.invuln > 0 && Math.floor(frames/4)%2===0) return;
            ctx.fillStyle = '#fff';
            ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = '#3498db';
            ctx.beginPath(); ctx.arc(this.x, this.y, this.radius*0.5, 0, Math.PI*2); ctx.fill();
        }
    }

    class Enemy {
        constructor() {
            const side = Math.random() * Math.PI * 2;
            const dist = canvas.width;
            this.x = player.x + Math.cos(side) * dist;
            this.y = player.y + Math.sin(side) * dist;
            this.radius = 14;
            this.hp = 40 + (score * 0.05);
            this.maxHp = this.hp;
            this.speed = 1.5 + Math.random();
            this.flash = 0;
            this.lastThornHit = 0;
            this.damage = 10; 
        }
        update() {
            const ang = Math.atan2(player.y - this.y, player.x - this.x);
            this.x += Math.cos(ang) * this.speed * dt;
            this.y += Math.sin(ang) * this.speed * dt;
            
            const distToPlayer = getDist(this.x, this.y, player.x, player.y);
            
            if(distToPlayer < this.radius + player.radius) {
                player.takeDamage(this.damage);
                
                if(player.levels.thorns > 0) {
                    const now = frames;
                    if(now - this.lastThornHit > 30) { 
                        this.takeDamage(player.damage * 0.25 * player.levels.thorns, 0.5);
                        this.lastThornHit = now;
                    }
                }
            }
            
            if(this.flash > 0) this.flash -= dt;
        }
        takeDamage(dmg, knock=2) {
            this.hp -= dmg;
            this.flash = 5;
            hitStop = 1;
            const ang = Math.atan2(this.y - player.y, this.x - player.x);
            this.x += Math.cos(ang) * knock * 5;
            this.y += Math.sin(ang) * knock * 5;
            
            if(settings.showText) texts.push(new FloatingText(this.x, this.y - 10, Math.floor(dmg)));
            if(this.hp <= 0) this.die();
            else AudioSys.impact();
        }
        die() {
            score += 100;
            gems.push(new Gem(this.x, this.y));
            if(settings.particles) {
                for(let i=0; i<5; i++) particles.push(new Particle(this.x, this.y, '#e74c3c'));
            }
            this.markedForDeletion = true;
        }
        draw() {
            ctx.fillStyle = this.flash > 0 ? '#fff' : '#e74c3c';
            ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2); ctx.fill();
            
            if(settings.showBars) {
                ctx.fillStyle = '#333';
                ctx.fillRect(this.x - 10, this.y - 20, 20, 3);
                ctx.fillStyle = '#e74c3c';
                ctx.fillRect(this.x - 10, this.y - 20, 20 * (this.hp/this.maxHp), 3);
            }
        }
    }

    class Boss extends Enemy {
        constructor() {
            super();
            const side = Math.random() * Math.PI * 2;
            const dist = canvas.width * 1.5;
            
            this.x = player.x + Math.cos(side) * dist;
            this.y = player.y + Math.sin(side) * dist;
            
            this.name = "Placeholder Boss";
            this.radius = 40; 
            this.hp = 5000; 
            this.maxHp = this.hp;
            this.speed = 1.2; 
            this.damage = 40; 
            this.color = '#f1c40f'; 
            this.flash = 0;
            this.dialogue = ["Placeholder", "Placeholder", "Placeholder..."];
        }

        update() {
            const ang = Math.atan2(player.y - this.y, player.x - this.x);
            this.x += Math.cos(ang) * this.speed * dt;
            this.y += Math.sin(ang) * this.speed * dt;
            
            const distToPlayer = getDist(this.x, this.y, player.x, player.y);
            
            if(distToPlayer < this.radius + player.radius) {
                player.takeDamage(this.damage);
            }
            
            if(this.flash > 0) this.flash -= dt;
        }

        draw() {
            ctx.fillStyle = this.flash > 0 ? '#fff' : this.color;
            ctx.shadowBlur = 20; ctx.shadowColor = this.color;
            ctx.beginPath(); ctx.arc(this.x, this.y, this.radius, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;

            const barW = 100;
            ctx.fillStyle = '#333';
            ctx.fillRect(this.x - barW/2, this.y - this.radius - 20, barW, 10);
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x - barW/2, this.y - this.radius - 20, barW * (this.hp/this.maxHp), 10);
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px Orbitron';
            ctx.textAlign = 'center';
            ctx.fillText("BOSS", this.x, this.y - this.radius - 25);
        }

        die() {
            bossActive = false;
            score += 5000;
            gems.push(new Gem(this.x, this.y));
            gems.push(new Gem(this.x, this.y));
            gems.push(new Gem(this.x, this.y)); 
            
            if(settings.particles) {
                for(let i=0; i<20; i++) particles.push(new Particle(this.x, this.y, '#f1c40f'));
            }
            this.markedForDeletion = true;
            
            DialogueSys.say("SYSTEM", ["THREAT NEUTRALIZED"]);
        }
    }

    class Projectile {
        constructor(x, y, ang, dmg, spd, crit, type) {
            this.x = x; this.y = y; this.ang = ang;
            this.dmg = dmg; this.spd = spd; this.crit = crit;
            this.type = type;
            this.maxLife = 150 * player.projLifeMult;
            this.life = this.maxLife; 
            this.pierce = player.pierceCount;
            this.ricochet = player.ricochetCount;
            this.hasBounced = false;
            this.lastHit = null; 
        }
        update() {
            const velMult = player.projVelMult || 1;
            this.x += Math.cos(this.ang) * this.spd * velMult * dt;
            this.y += Math.sin(this.ang) * this.spd * velMult * dt;
            this.life -= dt;
            
            enemies.forEach(e => {
                if(getDist(this.x, this.y, e.x, e.y) < e.radius + 10) {
                    if(this.lastHit === e && !this.hasBounced) return;

                    e.takeDamage(this.dmg);
                    if(player.aoe > 0) this.explode();
                    this.lastHit = e;
                    
                    if(this.pierce > 0) {
                        this.pierce--;
                        this.dmg *= 0.8;
                    } else if (this.ricochet > 0) {
                        this.ricochet--;
                        this.hasBounced = true;
                        this.life = this.maxLife * 0.6; 
                        
                        let newTarget = null;
                        let minD = Infinity;
                        enemies.forEach(ne => {
                            if(ne !== e) {
                                const d = getDist(this.x, this.y, ne.x, ne.y);
                                if(d < minD && d < 300) { minD = d; newTarget = ne; }
                            }
                        });
                        
                        if(newTarget) {
                            this.ang = Math.atan2(newTarget.y - this.y, newTarget.x - this.x);
                        } else {
                            this.life = 0; 
                        }
                    } else {
                        this.life = 0;
                    }
                }
            });
        }
        explode() {
            enemies.forEach(e => {
                if(getDist(this.x, this.y, e.x, e.y) < player.aoe) {
                    e.takeDamage(this.dmg * 0.5, 0.5);
                }
            });
            if(settings.particles) {
                for(let i=0; i<5; i++) particles.push(new Particle(this.x, this.y, '#f39c12'));
            }
        }
        draw() {
            ctx.fillStyle = this.crit ? '#f1c40f' : '#fff';
            ctx.shadowBlur = 5;
            ctx.shadowColor = ctx.fillStyle;
            ctx.beginPath(); ctx.arc(this.x, this.y, this.crit?5:3, 0, Math.PI*2); ctx.fill();
            ctx.shadowBlur = 0;
        }
    }

    class Gem {
        constructor(x, y) { this.x = x; this.y = y; }
        update() {
            const d = getDist(this.x, this.y, player.x, player.y);
            if(d < player.magnet) {
                const ang = Math.atan2(player.y - this.y, player.x - this.x);
                this.x += Math.cos(ang) * 8 * dt;
                this.y += Math.sin(ang) * 8 * dt;
            }
            if(d < 20) { player.gainXp(5); this.markedForDeletion = true; }
        }
        draw() {
            ctx.fillStyle = '#2ecc71';
            ctx.beginPath(); ctx.arc(this.x, this.y, 3, 0, Math.PI*2); ctx.fill();
        }
    }

    class Particle {
        constructor(x, y, color) {
            this.x = x; this.y = y; this.color = color;
            this.vx = (Math.random()-0.5) * 6;
            this.vy = (Math.random()-0.5) * 6;
            this.alpha = 1;
            this.size = Math.random() * 3 + 1;
        }
        update() {
            this.x += this.vx * dt; this.y += this.vy * dt;
            this.alpha -= 0.03 * dt;
        }
        draw() {
            ctx.globalAlpha = Math.max(0, this.alpha);
            ctx.fillStyle = this.color;
            ctx.fillRect(this.x, this.y, this.size, this.size);
            ctx.globalAlpha = 1;
        }
    }

    class FloatingText {
        constructor(x, y, val) { 
            this.x = x; this.y = y; this.val = val; 
            this.life = 1.0; 
            this.vy = -1; 
        }
        update() { 
            this.y += this.vy * dt; 
            this.life -= 0.02 * dt; 
        }
        draw() {
            ctx.globalAlpha = Math.max(0, this.life);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 14px Orbitron';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 3;
            ctx.strokeText(this.val, this.x, this.y);
            ctx.fillText(this.val, this.x, this.y);
            ctx.globalAlpha = 1;
        }
    }

    // --- GAME INITIALIZATION ---
    let player = new Player();
    let enemies = [], projectiles = [], gems = [], particles = [], texts = [];

    const upgradePool = [
        { id:'dmg', name:'ATK_UP', desc:'Increases base damage', type:'AUGMENT' },
        { id:'rate', name:'CD_REDUCT', desc:'Increases fire rate', type:'AUGMENT' },
        { id:'spd', name:'MOVE_SPD', desc:'Faster movement', type:'AUGMENT' },
        { id:'mag', name:'MAGNET', desc:'Greater XP attraction', type:'UTILITY' },
        { id:'orb', name:'ORBITAL', desc:'Add defensive drone', type:'WEAPON' },
        { id:'reg', name:'REGEN', desc:'Heal over time', type:'UTILITY' },
        { id:'aoe', name:'BLAST', desc:'Explosive rounds', type:'AUGMENT' },
        { id:'crit', name:'CRIT', desc:'10% double damage', type:'AUGMENT' },
        { id:'pierce', name:'PIERCE', desc:'Shots pass +1 enemy', type:'AUGMENT' },
        { id:'projSpd', name:'VELOCITY', desc:'Faster projectiles', type:'AUGMENT' },
        { id:'size', name:'HULL', desc:'Larger collision', type:'UTILITY' },
        { id:'multishot', name:'MULTI_SHOT', desc:'Fire +1 extra projectile', type:'WEAPON' },
        { id:'ricochet', name:'BOUNCE', desc:'Bullets bounce to new targets', type:'AUGMENT' },
        { id:'thorns', name:'THORNS', desc:'Damage enemies on contact', type:'DEFENSE' },
        { id:'duration', name:'RANGE', desc:'Projectiles travel further', type:'AUGMENT' }
    ];

    // --- TERMINAL SYSTEM ---
    const Terminal = {
        visible: false,
        commandList: [
            '/weapon', '/stat', '/lvl', '/xp', '/hp', '/maxhp', '/allup', '/spawn', 
            '/killall', '/score', '/gems', '/invuln', '/particles', '/text', '/crtop', '/zoom', '/clear'
        ],
        init() {
            const inputEl = document.getElementById('terminal-input');
            const suggestEl = document.getElementById('terminal-suggestions');
            
            inputEl.addEventListener('input', (e) => this.handleInput(e.target.value));
            inputEl.addEventListener('keydown', (e) => {
                if(e.key === 'Enter') {
                    this.execute(e.target.value);
                    e.target.value = '';
                    this.handleInput('');
                }
            });
        },
        toggle() {
            const container = document.getElementById('terminal-container');
            this.visible = !this.visible;
            container.style.display = this.visible ? 'block' : 'none';
            if(this.visible) {
                setTimeout(() => document.getElementById('terminal-input').focus(), 50);
            }
        },
        handleInput(val) {
            const suggestEl = document.getElementById('terminal-suggestions');
            if(!val || !val.startsWith('/')) {
                suggestEl.style.display = 'none';
                return;
            }
            const matches = this.commandList.filter(c => c.startsWith(val));
            suggestEl.innerHTML = '';
            if(matches.length > 0) {
                suggestEl.style.display = 'flex';
                matches.forEach(m => {
                    const div = document.createElement('div');
                    div.className = 'term-suggestion';
                    div.innerText = m;
                    div.onclick = () => {
                        const inputEl = document.getElementById('terminal-input');
                        inputEl.value = m + ' ';
                        inputEl.focus();
                        this.handleInput(inputEl.value);
                    };
                    suggestEl.appendChild(div);
                });
            } else {
                suggestEl.style.display = 'none';
            }
        },
        log(msg) {
            const out = document.getElementById('terminal-output');
            const line = document.createElement('div');
            line.innerText = `> ${msg}`;
            out.appendChild(line);
            out.scrollTop = out.scrollHeight;
        },
        execute(str) {
            const parts = str.trim().split(' ');
            const cmd = parts[0];
            const arg1 = parts[1];
            const arg2 = parts[2];

            this.log(str);

            switch(cmd) {
                case '/weapon':
                    if(['blaster','shotgun','missile'].includes(arg1)) {
                        player.weapon = arg1;
                        this.log(`WEAPON SET TO ${arg1.toUpperCase()}`);
                    } else this.log('INVALID WEAPON');
                    break;
                case '/stat':
                    if(player.levels[arg1] !== undefined && !isNaN(arg2)) {
                        player.levels[arg1] = parseInt(arg2);
                        player.refreshStats();
                        this.log(`STAT ${arg1.toUpperCase()} SET TO ${arg2}`);
                    } else this.log('INVALID STAT OR VALUE');
                    break;
                case '/lvl':
                    player.lvl = parseInt(arg1) || 1;
                    player.refreshStats();
                    this.log(`LEVEL SET TO ${player.lvl}`);
                    break;
                case '/xp':
                    player.gainXp(parseInt(arg1) || 100);
                    this.log(`ADDED ${arg1 || 100} XP`);
                    break;
                case '/hp':
                    player.hp = parseInt(arg1) || 100;
                    this.log(`HP SET TO ${player.hp}`);
                    break;
                case '/maxhp':
                    player.maxHp = parseInt(arg1) || 100;
                    this.log(`MAX HP SET TO ${player.maxHp}`);
                    break;
                case '/allup':
                    for(let k in player.levels) player.levels[k] = 10;
                    player.refreshStats();
                    this.log('ALL STATS MAXED');
                    break;
                case '/spawn':
                    if(arg1 === 'boss') {
                        bossActive = true;
                        enemies.push(new Boss());
                        this.log('BOSS SPAWNED');
                    } else {
                        enemies.push(new Enemy());
                        this.log('ENEMY SPAWNED');
                    }
                    break;
                case '/killall':
                    enemies.forEach(e => e.die());
                    this.log('ALL ENEMIES ELIMINATED');
                    break;
                case '/score':
                    score = parseInt(arg1) || 0;
                    this.log(`SCORE SET TO ${score}`);
                    break;
                case '/gems':
                    for(let i=0; i<(parseInt(arg1)||10); i++) gems.push(new Gem(player.x + (Math.random()-0.5)*100, player.y + (Math.random()-0.5)*100));
                    this.log('GEMS SPAWNED');
                    break;
                case '/invuln':
                    player.godMode = !player.godMode;
                    this.log(`GOD MODE: ${player.godMode}`);
                    break;
                case '/particles':
                    settings.particles = !settings.particles;
                    this.log(`PARTICLES: ${settings.particles}`);
                    break;
                case '/text':
                    settings.showText = !settings.showText;
                    this.log(`TEXT: ${settings.showText}`);
                    break;
                case '/crtop':
                    settings.crtOpacity = parseFloat(arg1) || 0.25;
                    document.documentElement.style.setProperty('--crt-opacity', settings.crtOpacity);
                    this.log(`CRT OPACITY: ${settings.crtOpacity}`);
                    break;
                case '/zoom':
                    settings.zoom = parseFloat(arg1) || 1.0;
                    this.log(`ZOOM: ${settings.zoom}`);
                    break;
                case '/clear':
                    document.getElementById('terminal-output').innerHTML = '';
                    break;
                default:
                    this.log('UNKNOWN COMMAND');
            }
            player.updateUI();
        }
    };
    
    // Initialize terminal listeners
    Terminal.init();
    window.toggleTerminal = () => Terminal.toggle();

    function showUpgradeMenu() {
        state = 'paused';
        const menu = document.getElementById('upgrade-menu');
        const container = document.getElementById('upgrade-options');
        container.innerHTML = '';
        const shuffled = [...upgradePool].sort(() => 0.5 - Math.random()).slice(0, 3);
        
        shuffled.forEach(u => {
            const card = document.createElement('div');
            card.className = 'upgrade-card';
            card.innerHTML = `
                <span class="type">${u.type}</span>
                <h3>${u.name}</h3>
                <p>${u.desc}</p>
            `;
            card.onclick = () => {
                player.levels[u.id]++;
                player.refreshStats();
                menu.style.display = 'none';
                state = 'running';
                lastTime = performance.now();
                requestAnimationFrame(loop);
            };
            container.appendChild(card);
        });
        menu.style.display = 'block';
    }

    function gameOver() {
        state = 'gameover';
        document.getElementById('game-over').style.display = 'block';
        document.getElementById('final-score').innerText = score;
    }

    function spawn() {
        // BOSS SPAWN LOGIC
        if(player.lvl === 10 && !bossActive) {
            bossActive = true;
            const boss = new Boss();
            enemies.push(boss);
            
            setTimeout(() => {
                const bossSnd = new Audio('https://github.com/Sharky69-Boy/GAME/raw/9affceace914a384faf493aeb750020c9aedba38/1767873074332.mp3');
                bossSnd.volume = settings.volume;
                bossSnd.play().catch(e => console.warn(e));
                
                DialogueSys.say(boss.name, boss.dialogue);
            }, 1000);
            return;
        }

        if(!bossActive && frames % 60 === 0) enemies.push(new Enemy());
    }

    // --- SETTINGS LOGIC EXPOSED TO WINDOW FOR JSX ONCLICK ---
    window.toggleSettings = function() {
        const menu = document.getElementById('settings-menu');
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
        if(state === 'running' && menu.style.display === 'block') {
            lastTime = performance.now(); 
        }
    }

    window.updateSettings = function() {
        settings.volume = parseFloat(document.getElementById('vol-slider').value);
        settings.zoom = parseFloat(document.getElementById('zoom-slider').value);
        settings.crtOpacity = parseFloat(document.getElementById('crt-slider').value);
        settings.particles = document.getElementById('part-check').checked;
        settings.showText = document.getElementById('text-check').checked;
        settings.showBars = document.getElementById('hp-bar-check').checked;
        document.documentElement.style.setProperty('--crt-opacity', settings.crtOpacity);
    }

    // --- JOYSTICK ---
    const joyZone = document.getElementById('joystick-zone');
    const joyKnob = document.getElementById('joystick-knob');
    let joyActive = false;
    // Check for touch
    if ('ontouchstart' in window) joyZone.style.display = 'block';

    function handleJoy(e) {
        const touch = e.touches ? e.touches[0] : e;
        const rect = joyZone.getBoundingClientRect();
        const cx = rect.left + rect.width/2;
        const cy = rect.top + rect.height/2;
        let dx = touch.clientX - cx;
        let dy = touch.clientY - cy;
        const d = Math.hypot(dx, dy);
        const max = 30; 
        if(d > max) { dx *= max/d; dy *= max/d; }
        joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        input.x = dx/max; input.y = dy/max;
    }

    const onTouchStart = e => { joyActive = true; handleJoy(e); };
    const onTouchMove = e => { if(joyActive) { e.preventDefault(); handleJoy(e); } };
    const onTouchEnd = () => { joyActive = false; input.x = 0; input.y = 0; joyKnob.style.transform = 'translate(-50%, -50%)'; };

    joyZone.addEventListener('touchstart', onTouchStart);
    window.addEventListener('touchmove', onTouchMove, {passive:false});
    window.addEventListener('touchend', onTouchEnd);

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resize);
    resize();

    // --- MAIN LOOP ---
    function loop(time) {
        if(state !== 'running') return;
        
        dt = (time - lastTime) / 16.67;
        if(dt > 1.5) dt = 1.5; 
        if(dt < 0.8) dt = 0.8;
        lastTime = time;

        if(hitStop > 0) {
            hitStop--;
            requestAnimationFrame(loop);
            return;
        }

        frames++;
        spawn();

        player.update();
        [...enemies, ...projectiles, ...gems, ...particles, ...texts].forEach(e => e.update());
        
        enemies = enemies.filter(e => !e.markedForDeletion);
        projectiles = projectiles.filter(p => p.life > 0);
        gems = gems.filter(g => !g.markedForDeletion);
        particles = particles.filter(p => p.alpha > 0);
        texts = texts.filter(t => t.life > 0);

        // Camera update
        camera.x = lerp(camera.x, player.x - canvas.width/2, 0.15);
        camera.y = lerp(camera.y, player.y - canvas.height/2, 0.15);
        if(camera.shake > 0) camera.shake *= 0.9;

        // Rendering
        ctx.fillStyle = '#050507';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.save();
        const shakeX = (Math.random()-0.5) * camera.shake;
        const shakeY = (Math.random()-0.5) * camera.shake;
        
        ctx.translate(canvas.width/2, canvas.height/2);
        ctx.scale(settings.zoom, settings.zoom);
        ctx.translate(-canvas.width/2, -canvas.height/2);
        ctx.translate(-camera.x + shakeX, -camera.y + shakeY);
        
        // GRID
        ctx.strokeStyle = '#111';
        ctx.lineWidth = 1;
        const startGridX = Math.floor(camera.x / 100) * 100;
        const startGridY = Math.floor(camera.y / 100) * 100;
        const viewDist = Math.max(canvas.width, canvas.height) / settings.zoom + 200;
        
        ctx.beginPath();
        for(let x=startGridX; x<startGridX+viewDist; x+=100) {
            ctx.moveTo(x, camera.y); ctx.lineTo(x, camera.y+viewDist);
        }
        for(let y=startGridY; y<startGridY+viewDist; y+=100) {
            ctx.moveTo(camera.x, y); ctx.lineTo(camera.x+viewDist, y);
        }
        ctx.stroke();

        gems.forEach(g => g.draw());
        enemies.forEach(e => e.draw());
        player.draw();
        projectiles.forEach(p => p.draw());
        particles.forEach(p => p.draw());
        texts.forEach(t => t.draw());
        
        ctx.restore();
        requestAnimationFrame(loop);
    }

    const startBtn = document.getElementById('start-btn');
    if(startBtn) {
        startBtn.onclick = () => {
            AudioSys.init();
            document.getElementById('start-screen').style.display = 'none';
            state = 'running';
            lastTime = performance.now();
            requestAnimationFrame(loop);
        };
    }

    // CLEANUP
    return () => {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('resize', resize);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onTouchEnd);
        if (joyZone) joyZone.removeEventListener('touchstart', onTouchStart);
        state = 'unmounted';
        delete window.toggleSettings;
        delete window.updateSettings;
        delete window.toggleTerminal;
    };
  }, []);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap');

        :root {
            --crt-opacity: 0.25;
            --ui-bg: rgba(5, 5, 7, 0.85);
            --ui-border: rgba(52, 152, 219, 0.4);
            --accent: #3498db;
            --danger: #e74c3c;
            --gold: #f1c40f;
        }

        body {
            margin: 0;
            overflow: hidden;
            background-color: #050507;
            color: white;
            font-family: 'Orbitron', sans-serif;
            user-select: none;
            touch-action: none;
        }
        
        canvas {
            display: block;
            position: absolute;
            top: 0;
            left: 0;
            z-index: 1;
        }

        /* CRT Effect */
        body::after {
            content: " ";
            position: absolute;
            top: 0; left: 0; bottom: 0; right: 0;
            background: linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, var(--crt-opacity)) 50%), 
                        linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06));
            z-index: 100;
            background-size: 100% 4px, 3px 100%;
            pointer-events: none;
            transition: background 0.2s;
        }

        /* COMPACT HUD */
        #ui-layer {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            pointer-events: none;
            z-index: 10;
            display: flex;
            flex-direction: column;
            padding: 12px;
            box-sizing: border-box;
        }

        #hud {
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            pointer-events: none;
        }

        .hud-left {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        #score-display {
            font-size: 20px;
            font-weight: 900;
            color: var(--gold);
            text-shadow: 0 0 8px rgba(241, 196, 15, 0.5);
        }
        #weapon-display {
            font-size: 9px;
            color: #888;
            text-transform: uppercase;
        }

        .hud-center {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 4px;
            margin: 0 20px;
            max-width: 250px;
        }
        .bar-container {
            width: 100%;
            height: 5px;
            background: rgba(255,255,255,0.1);
            border-radius: 2px;
            overflow: hidden;
        }
        .bar-fill {
            height: 100%;
            width: 0%;
            transition: width 0.1s linear;
        }
        #hp-bar { background: var(--danger); }
        #xp-bar { background: var(--accent); }

        .hud-right {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .level-badge {
            font-size: 12px;
            font-weight: bold;
            padding: 2px 8px;
            background: var(--ui-bg);
            border: 1px solid var(--ui-border);
            border-radius: 2px;
        }
        .settings-btn {
            background: var(--ui-bg);
            border: 1px solid #555;
            color: #ddd;
            width: 26px;
            height: 26px;
            border-radius: 3px;
            cursor: pointer;
            pointer-events: auto;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }
        .settings-btn:hover { border-color: var(--accent); color: var(--accent); }

        /* DIALOGUE UI */
        #dialogue-ui {
            position: absolute;
            bottom: 15%;
            left: 50%;
            transform: translateX(-50%);
            width: 70%;
            max-width: 500px;
            background: rgba(0, 0, 0, 0.9);
            border: 2px solid var(--gold);
            border-radius: 4px;
            padding: 15px;
            z-index: 150;
            display: none;
            pointer-events: none;
            box-shadow: 0 0 20px rgba(241, 196, 15, 0.2);
        }
        #dialogue-name {
            color: var(--gold);
            font-size: 14px;
            font-weight: bold;
            margin-bottom: 8px;
            text-transform: uppercase;
            letter-spacing: 1px;
            border-bottom: 1px solid rgba(255,255,255,0.2);
            padding-bottom: 4px;
        }
        #dialogue-text {
            color: #fff;
            font-size: 16px;
            min-height: 24px;
        }

        /* MENUS */
        .overlay-menu {
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(8, 8, 12, 0.96);
            backdrop-filter: blur(5px);
            border: 1px solid #444;
            text-align: center;
            display: none;
            pointer-events: auto;
            z-index: 200;
            width: 90%;
            max-width: 700px;
            padding: 25px;
            border-radius: 6px;
        }

        .menu-header {
            font-size: 20px;
            margin-bottom: 15px;
            color: #fff;
            border-bottom: 1px solid #333;
            padding-bottom: 8px;
            letter-spacing: 2px;
        }

        .upgrades-container {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 12px;
        }
        @media (max-width: 600px) { .upgrades-container { grid-template-columns: 1fr; } }

        .upgrade-card {
            background: #15151a;
            border: 1px solid #333;
            padding: 12px;
            cursor: pointer;
            transition: 0.1s;
            border-radius: 4px;
        }
        .upgrade-card:hover {
            border-color: var(--gold);
            background: #1e1e26;
        }
        .upgrade-card h3 { margin: 0 0 4px 0; font-size: 13px; color: #fff; }
        .upgrade-card p { margin: 0; font-size: 10px; color: #888; line-height: 1.3; }
        .type { color: var(--accent); font-size: 8px; display: block; margin-bottom: 4px; }

        /* SETTINGS */
        .settings-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
            text-align: left;
        }
        .setting-item { display: flex; flex-direction: column; gap: 5px; }
        .setting-label { font-size: 11px; color: #aaa; text-transform: uppercase; letter-spacing: 1px; }
        input[type="range"] { width: 100%; accent-color: var(--accent); }
        
        #start-screen, #game-over {
            z-index: 300; background: #000; width: 100%; height: 100%;
            top:0; left:0; transform:none; border:none;
            pointer-events: auto;
        }
        
        h1 { font-size: 36px; margin: 0; color: #fff; letter-spacing: 3px; }
        .subtitle { font-size: 10px; color: #666; letter-spacing: 2px; margin-bottom: 20px; }

        .btn {
            padding: 12px 30px; font-family: 'Orbitron'; background: transparent;
            color: #fff; border: 1px solid #fff; font-size: 14px; cursor: pointer;
            transition: 0.2s; text-transform: uppercase; letter-spacing: 2px;
        }
        .btn:hover { background: #fff; color: #000; }

        #damage-overlay {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background: radial-gradient(circle, transparent 50%, rgba(231, 76, 60, 0.4) 100%);
            opacity: 0; pointer-events: none; z-index: 5; transition: opacity 0.1s;
        }

        #joystick-zone {
            position: absolute; bottom: 40px; left: 40px; width: 100px; height: 100px;
            background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 50%; pointer-events: auto; display: none;
        }
        #joystick-knob {
            position: absolute; top: 50%; left: 50%; width: 40px; height: 40px;
            background: rgba(52, 152, 219, 0.4); border: 1px solid rgba(52, 152, 219, 0.6);
            border-radius: 50%; transform: translate(-50%, -50%);
        }

        /* TERMINAL STYLES */
        .term-suggestion {
            padding: 5px 8px;
            font-size: 10px;
            color: #888;
            cursor: pointer;
            background: #15151a;
            border: 1px solid #222;
            margin: 2px;
            display: inline-block;
        }
        .term-suggestion:hover {
            background: #333;
            color: var(--accent);
            border-color: var(--accent);
        }
        #terminal-input:focus {
            outline: none;
            border-color: var(--accent);
        }
        /* Custom Scrollbar */
        #terminal-output::-webkit-scrollbar { width: 4px; }
        #terminal-output::-webkit-scrollbar-thumb { background: #333; }
        #terminal-output::-webkit-scrollbar-track { background: #000; }
      `}</style>

      <div id="damage-overlay"></div>

      <div id="dialogue-ui">
          <div id="dialogue-name">UNKNOWN</div>
          <div id="dialogue-text">...</div>
      </div>

      <div id="ui-layer">
          <div id="hud">
              <div className="hud-left">
                  <div id="score-display">000000</div>
                  <div id="weapon-display">SYS_READY</div>
              </div>

              <div className="hud-center">
                  <div className="bar-container"><div id="hp-bar" className="bar-fill"></div></div>
                  <div className="bar-container" style={{height:'3px', opacity: 0.6}}><div id="xp-bar" className="bar-fill"></div></div>
              </div>

              <div className="hud-right">
                  <div className="level-badge">LVL <span id="lvl-display">1</span></div>
                  <button className="settings-btn" onClick={() => window.toggleSettings && window.toggleSettings()}>⚙</button>
              </div>
          </div>

          <div id="joystick-zone"><div id="joystick-knob"></div></div>

          <div id="upgrade-menu" className="overlay-menu">
              <div className="menu-header">SYSTEM UPGRADE</div>
              <div className="upgrades-container" id="upgrade-options"></div>
          </div>

          <div id="settings-menu" className="overlay-menu">
              <div className="menu-header" style={{cursor: 'pointer'}} onClick={() => window.toggleTerminal && window.toggleTerminal()} title="Click to open terminal">CONFIGURATION</div>
              
              <div id="terminal-container" style={{display: 'none', marginTop: '15px', borderTop: '1px solid #333', paddingTop: '10px'}}>
                  <div id="terminal-output" style={{maxHeight: '100px', overflowY: 'auto', fontSize: '10px', color: '#888', marginBottom: '5px', fontFamily: 'monospace', textAlign: 'left', whiteSpace: 'pre-wrap'}}></div>
                  <div style={{position: 'relative'}}>
                      <input type="text" id="terminal-input" placeholder="ENTER COMMAND..." style={{width: '100%', background: '#000', border: '1px solid #333', color: 'var(--accent)', fontFamily: 'Orbitron', padding: '5px', boxSizing: 'border-box', textTransform: 'uppercase'}} autoComplete="off" />
                      <div id="terminal-suggestions" style={{position: 'absolute', top: '100%', left: '0', width: '100%', background: '#111', border: '1px solid #333', display: 'none', flexDirection: 'row', flexWrap: 'wrap', zIndex: 10}}></div>
                  </div>
              </div>

              <div className="settings-grid" style={{marginTop: '15px'}}>
                  <div className="setting-item">
                      <span className="setting-label">Master Volume</span>
                      <input type="range" id="vol-slider" min="0" max="1" step="0.1" defaultValue="0.8" onInput={() => window.updateSettings && window.updateSettings()} />
                  </div>
                  <div className="setting-item">
                      <span className="setting-label">Zoom Level</span>
                      <input type="range" id="zoom-slider" min="0.6" max="1.4" step="0.1" defaultValue="1" onInput={() => window.updateSettings && window.updateSettings()} />
                  </div>
                  <div className="setting-item">
                      <span className="setting-label">CRT Intensity</span>
                      <input type="range" id="crt-slider" min="0" max="0.5" step="0.05" defaultValue="0.25" onInput={() => window.updateSettings && window.updateSettings()} />
                  </div>
                  <div className="setting-item">
                      <span className="setting-label">Particles</span>
                      <input type="checkbox" id="part-check" defaultChecked onChange={() => window.updateSettings && window.updateSettings()} />
                  </div>
                  <div className="setting-item">
                      <span className="setting-label">Damage Numbers</span>
                      <input type="checkbox" id="text-check" defaultChecked onChange={() => window.updateSettings && window.updateSettings()} />
                  </div>
                  <div className="setting-item">
                      <span className="setting-label">Show HP Bars</span>
                      <input type="checkbox" id="hp-bar-check" defaultChecked onChange={() => window.updateSettings && window.updateSettings()} />
                  </div>
              </div>
              <button className="btn" style={{padding: '6px 15px', marginTop: '15px', fontSize: '10px'}} onClick={() => window.toggleSettings && window.toggleSettings()}>RESUME</button>
          </div>

          <div id="game-over" className="overlay-menu" style={{display: 'none'}}>
              <div className="menu-header" style={{color: 'var(--danger)'}}>CRITICAL FAILURE</div>
              <div style={{fontSize: '16px', marginBottom: '15px'}}>SCORE: <span id="final-score">0</span></div>
              <button className="btn" onClick={() => window.location.reload()}>REBOOT</button>
          </div>
          
          <div id="start-screen" className="overlay-menu" style={{display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center'}}>
              <h1>SURVIVOR-S</h1>
              <div className="subtitle">BOSS UPDATE v5.0 // UNIVERSAL DIALOGUE</div>
              <button className="btn" id="start-btn">INITIALIZE</button>
          </div>
      </div>

      <canvas id="gameCanvas" ref={canvasRef}></canvas>
    </>
  );
}