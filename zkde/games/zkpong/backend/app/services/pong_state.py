"""
Fixed-point Pong state and deterministic step. Scale 1e6 for all positions/velocities.
"""
import hashlib
from dataclasses import dataclass

SCALE = 1_000_000
WIDTH = 640 * SCALE
HEIGHT = 480 * SCALE
PADDLE_H = 60 * SCALE
PADDLE_W = 10 * SCALE
BALL_R = 5 * SCALE
PADDLE_X_LEFT = 20 * SCALE
PADDLE_X_RIGHT = WIDTH - 20 * SCALE - PADDLE_W
INITIAL_SPEED = 8 * SCALE // 10


@dataclass
class PongState:
    ball_x: int
    ball_y: int
    ball_vx: int
    ball_vy: int
    paddle_y: int
    ai_paddle_y: int
    rally_id: int
    score_left: int
    score_right: int

    def to_encoding(self) -> bytes:
        """Ordered encoding for state hash (8 bytes each, big-endian)."""
        parts = [
            self.ball_x.to_bytes(8, "big"),
            self.ball_y.to_bytes(8, "big"),
            self.ball_vx.to_bytes(8, "big"),
            self.ball_vy.to_bytes(8, "big"),
            self.paddle_y.to_bytes(8, "big"),
            self.ai_paddle_y.to_bytes(8, "big"),
            self.rally_id.to_bytes(8, "big"),
            self.score_left.to_bytes(8, "big"),
            self.score_right.to_bytes(8, "big"),
        ]
        return b"".join(parts)

    def state_hash(self) -> str:
        return hashlib.sha256(self.to_encoding()).hexdigest()


def _bounce_rng(seed_bytes: bytes, rally_id: int) -> int:
    """Deterministic integer from hash(seed || rally_id || 'ball')."""
    h = hashlib.sha256(seed_bytes + rally_id.to_bytes(8, "big") + b"ball").digest()
    return int.from_bytes(h[:8], "big")


def initial_state() -> PongState:
    return PongState(
        ball_x=WIDTH // 2,
        ball_y=HEIGHT // 2,
        ball_vx=INITIAL_SPEED,
        ball_vy=0,
        paddle_y=HEIGHT // 2 - PADDLE_H // 2,
        ai_paddle_y=HEIGHT // 2 - PADDLE_H // 2,
        rally_id=0,
        score_left=0,
        score_right=0,
    )


def step(
    state: PongState,
    seed_bytes: bytes,
    human_dy: int,
    ai_paddle_y: int,
) -> tuple:
    """
    One deterministic step. Returns (new_state, point_scored).
    human_dy: signed delta for left paddle (fixed-point).
    ai_paddle_y: AI paddle center (from policy).
    """
    ball_x = state.ball_x + state.ball_vx
    ball_y = state.ball_y + state.ball_vy
    ball_vx = state.ball_vx
    ball_vy = state.ball_vy
    paddle_y = max(0, min(HEIGHT - PADDLE_H, state.paddle_y + human_dy))
    rally_id = state.rally_id + 1
    score_left = state.score_left
    score_right = state.score_right
    point_scored = False

    # Wall bounces (top/bottom)
    if ball_y <= BALL_R:
        ball_vy = -ball_vy
        ball_y = 2 * BALL_R - ball_y
    if ball_y >= HEIGHT - BALL_R:
        ball_vy = -ball_vy
        ball_y = 2 * (HEIGHT - BALL_R) - ball_y

    # Left paddle
    if (
        state.ball_vx < 0
        and state.ball_x - BALL_R >= PADDLE_X_LEFT + PADDLE_W
        and ball_x - BALL_R <= PADDLE_X_LEFT + PADDLE_W
    ):
        if paddle_y - BALL_R <= ball_y <= paddle_y + PADDLE_H + BALL_R:
            rng = _bounce_rng(seed_bytes, rally_id)
            ball_vx = -ball_vx
            ball_x = 2 * (PADDLE_X_LEFT + PADDLE_W + BALL_R) - ball_x
            angle = (rng % 17) - 8
            ball_vy = (angle * INITIAL_SPEED) // 10

    # Right paddle (AI)
    if (
        state.ball_vx > 0
        and state.ball_x + BALL_R <= PADDLE_X_RIGHT
        and ball_x + BALL_R >= PADDLE_X_RIGHT
    ):
        if ai_paddle_y - BALL_R <= ball_y <= ai_paddle_y + PADDLE_H + BALL_R:
            rng = _bounce_rng(seed_bytes, rally_id)
            ball_vx = -ball_vx
            ball_x = 2 * PADDLE_X_RIGHT - ball_x - 2 * BALL_R
            angle = (rng % 17) - 8
            ball_vy = (angle * INITIAL_SPEED) // 10

    # Score
    if ball_x < 0:
        score_left += 1
        point_scored = True
        ball_x = WIDTH // 2
        ball_y = HEIGHT // 2
        ball_vx = -INITIAL_SPEED
        ball_vy = 0
    if ball_x > WIDTH:
        score_right += 1
        point_scored = True
        ball_x = WIDTH // 2
        ball_y = HEIGHT // 2
        ball_vx = INITIAL_SPEED
        ball_vy = 0

    return (
        PongState(
            ball_x=ball_x,
            ball_y=ball_y,
            ball_vx=ball_vx,
            ball_vy=ball_vy,
            paddle_y=paddle_y,
            ai_paddle_y=ai_paddle_y,
            rally_id=rally_id,
            score_left=score_left,
            score_right=score_right,
        ),
        point_scored,
    )
