import { Player } from '../common';
import { IncomingMsg, OutgoingMsg } from '../server';
import { GameClient, GameServer } from './game';
import { UserInput } from '../client/user-input';
import { getCollisionSide } from '../common';

// --- COSTANTI STILE "STREET FIGHTER" ---
const PLAYER_W = 0.15; // Più larghi
const PLAYER_H = 0.5;  // Molto più alti (quasi metà schermo verticale)
const GROUND_Y = 0.75; // Terreno leggermente più basso per dare spazio alla UI in alto
const GRAVITY = 5.0;   
const JUMP_FORCE = 1.8; 
const MOVE_SPEED = 0.7; 
const ATTACK_RANGE = 0.25; // Raggio aumentato proporzionalmente alla grandezza

export class FighterServer extends GameServer {
    private players;

    init(players) {
        this.players = players;
        let i = 0;
        Object.keys(players).forEach(id => {
            const player = players[id];
            player.x = (i % 2 === 0) ? -0.8 : 0.8 - PLAYER_W;
            player.y = GROUND_Y;
            player.vy = 0;
            player.jumpsRemaining = 1;
            player.health = 100;
            player.attackProcessed = false;
            player.wasJumpPressed = false;
            i++;
        });
    }

    tick(incomingMessages: IncomingMsg[], dt: number): OutgoingMsg[] {

        incomingMessages.forEach(message => {
            const player = this.players[message.clientId];
            const payload = message.payload;

            if (payload.kind === 'move' && player) {
                player.moveDir = payload.moveDir;

                // SALTO (edge trigger)
                if (payload.jump && !player.wasJumpPressed && player.jumpsRemaining > 0) {
                    player.vy = -JUMP_FORCE; // 🔴 NEGATIVO = SU
                    player.jumpsRemaining--;
                }

                player.wasJumpPressed = payload.jump;
                player.attackLight = payload.attackLight;
                player.attackHeavy = payload.attackHeavy;
            }
        });

        Object.keys(this.players).forEach(id => {
            const p = this.players[id];

            // Movimento X
            if (p.moveDir) p.x += p.moveDir * dt * MOVE_SPEED;

            // Gravità
            p.vy += GRAVITY * dt;

            // Posizione
            p.y += p.vy * dt;

            // Ground collision
            if (p.y >= GROUND_Y) {
                p.y = GROUND_Y;
                p.vy = 0;
                p.jumpsRemaining = 1;
            }

            // Limiti
            if (p.x < -1) p.x = -1;
            if (p.x + PLAYER_W > 1) p.x = 1 - PLAYER_W;
        });

        // Danni (uguale al tuo)
        Object.keys(this.players).forEach(attackerId => {
            const attacker = this.players[attackerId];

            if ((attacker.attackLight || attacker.attackHeavy) && !attacker.attackProcessed) {
                const damage = attacker.attackLight ? 10 : 22;

                Object.keys(this.players).forEach(targetId => {
                    if (targetId !== attackerId) {
                        const target = this.players[targetId];

                        const dx = (target.x + PLAYER_W/2) - (attacker.x + PLAYER_W/2);
                        const dy = (target.y - PLAYER_H/2) - (attacker.y - PLAYER_H/2);
                        const dist = Math.sqrt(dx*dx + dy*dy);

                        if (dist <= ATTACK_RANGE) {
                            target.health = Math.max(0, target.health - damage);
                        }
                    }
                });

                attacker.attackProcessed = true;
            }

            if (!attacker.attackLight && !attacker.attackHeavy) {
                attacker.attackProcessed = false;
            }
        });

        return [{ payload: { players: this.players } }];
    }

    isFinished(): boolean {
        return Object.values(this.players).some((p: any) => p.health <= 0);
    }
}

export class FighterClient extends GameClient {
    private players = null;
    private attackTimer = 0;
    private damageTimers: { [id: string]: number } = {};

    init(players) {
    }

    draw(ctx: CanvasRenderingContext2D, dt: number) {
        if (!this.players) return;

        const { screenW, screenH, moveDirectionX, jump, attackLight, attackHeavy } = this.userInput;
        const me = this.players[this.myId];

        // Movimento locale
        me.x += moveDirectionX * dt * MOVE_SPEED;

        if (jump && me.jumpsRemaining > 0 && me.vy === 0) {
            me.vy = -JUMP_FORCE; // 🔴 NEGATIVO
            me.jumpsRemaining--;
        }

        me.vy += GRAVITY * dt;
        me.y += me.vy * dt;

        if (me.y >= GROUND_Y) {
            me.y = GROUND_Y;
            me.vy = 0;
            me.jumpsRemaining = 1;
        }

        if (attackLight || attackHeavy) this.attackTimer = 12;
        if (this.attackTimer > 0) this.attackTimer--;

        // --- DISEGNO SCENA ---
        ctx.save();
        ctx.translate(screenW / 2, screenH / 2);
        // Zoom leggermente maggiore per avere i personaggi "in faccia"
        ctx.scale(screenW / 2, screenH / 2);

        // Background (Colore scuro "stage")
        ctx.fillStyle = "#1a1a2e"; 
        ctx.fillRect(-1, -1, 2, 2);

        // Pavimento stile "Street"
        ctx.fillStyle = "#333"; 
        ctx.fillRect(-1, GROUND_Y, 2, 1 - GROUND_Y);

        // Disegno combattenti
        Object.keys(this.players).forEach(id => {
            const player = this.players[id];
            let color = (id === this.myId) ? "#3498db" : "#e74c3c"; // Blu vs Rosso
            
            if (this.damageTimers[id] > 0) color = "white"; // Flash colpo subito
            else if (id === this.myId && this.attackTimer > 0) color = "#f1c40f"; // Giallo attacco

            ctx.fillStyle = color;
            // Ombra sotto il personaggio
            ctx.beginPath();
            ctx.ellipse(player.x + PLAYER_W/2, GROUND_Y, PLAYER_W/2, 0.03, 0, 0, Math.PI*2);
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            ctx.fill();

            ctx.fillStyle = color;
            ctx.fillRect(player.x, player.y - PLAYER_H, PLAYER_W, PLAYER_H);
        });

        ctx.restore();

        // --- UI IN PRIMO PIANO (BARRE HP IN ALTO) ---
        this.drawUI(ctx, screenW, screenH);

        // Update timer feedback
        Object.keys(this.damageTimers).forEach(id => {
            if (this.damageTimers[id] > 0) this.damageTimers[id]--;
        });
    }

    private drawUI(ctx: CanvasRenderingContext2D, w: number, h: number) {
        const ids = Object.keys(this.players);
        const margin = 50;
        const barWidth = w * 0.35;
        const barHeight = 30;

        ids.forEach((id, index) => {
            const player = this.players[id];
            const isLeft = index === 0;
            const x = isLeft ? margin : w - margin - barWidth;
            const y = 40;

            // Nome Combattente
            ctx.font = "bold 28px Impact";
            ctx.fillStyle = "white";
            ctx.textAlign = isLeft ? "left" : "right";
            ctx.fillText(player.name.toUpperCase(), isLeft ? x : x + barWidth, y - 10);

            // Sfondo Barra (Grigio scuro)
            ctx.fillStyle = "#444";
            ctx.fillRect(x, y, barWidth, barHeight);

            // Barra Salute (Gialla/Rossa stile SF)
            const hpWidth = (player.health / 100) * barWidth;
            const hpColor = player.health > 30 ? "#f1c40f" : "#c0392b";
            ctx.fillStyle = hpColor;
            
            if (isLeft) {
                ctx.fillRect(x, y, hpWidth, barHeight);
            } else {
                // La barra del secondo giocatore scende verso il centro
                ctx.fillRect(x + (barWidth - hpWidth), y, hpWidth, barHeight);
            }

            // Bordo barra
            ctx.strokeStyle = "white";
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, barWidth, barHeight);
        });

        // Testo "VS" al centro
        ctx.font = "bold 40px Impact";
        ctx.fillStyle = "#e74c3c";
        ctx.textAlign = "center";
        ctx.fillText("VS", w / 2, 65);
    }

    handleMessage(message: any) {
        if (!this.players) {
            this.players = message.players;
            return;
        }
        Object.keys(message.players).forEach(id => {
            const oldHp = this.players[id]?.health || 100;
            const newP = message.players[id];
            if (id !== this.myId) this.players[id] = newP;
            else this.players[id].health = newP.health;

            if (newP.health < oldHp) this.damageTimers[id] = 8;
        });
    }

    flushMessages(): any[] {
        const { moveDirectionX, jump, attackLight, attackHeavy } = this.userInput;
        return [{
            kind: 'move',
            moveDir: moveDirectionX,
            jump: jump,
            attackLight: attackLight,
            attackHeavy: attackHeavy
        }];
    }

    isFinished(): boolean {
        return this.players && Object.values(this.players).some((p: any) => p.health <= 0);
    }
}