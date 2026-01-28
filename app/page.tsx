"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, useConnect, useSendTransaction } from "wagmi";
import { base } from "wagmi/chains";
import { useMiniApp } from "./providers/MiniAppProvider";
import styles from "./page.module.css";

type Direction = "up" | "down" | "left" | "right";
type Point = { x: number; y: number };
type Crystal = Point & { id: string };

const GAME_CONFIG = {
  gridSize: 11,
  roundSeconds: 120,
  moveIntervalMs: 220,
  spawnIntervalMs: 1200,
  maxCrystals: 5,
  spawnBurstMax: 2,
};

const TX_CONFIG = {
  recipient:
    (process.env.NEXT_PUBLIC_CRYSTAL_RECIPIENT as `0x${string}` | undefined) ||
    undefined,
};

const directionVectors: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const getCenter = () =>
  Math.floor(GAME_CONFIG.gridSize / 2);

const makeId = () =>
  Math.random().toString(36).slice(2, 10);

export default function Home() {
  const { context, isReady } = useMiniApp();
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { sendTransactionAsync } = useSendTransaction();

  const [runner, setRunner] = useState<Point>({
    x: getCenter(),
    y: getCenter(),
  });
  const [direction, setDirection] = useState<Direction>("right");
  const [crystals, setCrystals] = useState<Crystal[]>([]);
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_CONFIG.roundSeconds);
  const [isRunning, setIsRunning] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isGameOver, setIsGameOver] = useState(false);
  const [flash, setFlash] = useState(false);
  const [status, setStatus] = useState("Connect wallet to record onchain.");
  const [pendingTxCount, setPendingTxCount] = useState(0);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const directionRef = useRef(direction);
  const crystalsRef = useRef(crystals);
  const txQueueRef = useRef(Promise.resolve());
  const touchStartRef = useRef<Point | null>(null);
  const flashTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    directionRef.current = direction;
  }, [direction]);

  useEffect(() => {
    crystalsRef.current = crystals;
  }, [crystals]);

  useEffect(() => {
    if (!isConnected) {
      setStatus("Connect wallet to record onchain.");
    } else if (pendingTxCount > 0) {
      setStatus(`Recording onchain (${pendingTxCount})...`);
    } else if (lastTxHash) {
      setStatus("Crystal confirmed onchain.");
    } else {
      setStatus("Wallet ready for onchain proof.");
    }
  }, [isConnected, pendingTxCount, lastTxHash]);

  const resetGame = useCallback(() => {
    setRunner({ x: getCenter(), y: getCenter() });
    setDirection("right");
    setCrystals([]);
    setScore(0);
    setTimeLeft(GAME_CONFIG.roundSeconds);
    setIsRunning(true);
    setIsGameOver(false);
  }, []);

  const startGame = useCallback(() => {
    setHasStarted(true);
    resetGame();
  }, [resetGame]);

  const endGame = useCallback(() => {
    setIsRunning(false);
    setIsGameOver(true);
  }, []);

  const triggerFlash = useCallback(() => {
    setFlash(true);
    if (flashTimeoutRef.current) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    flashTimeoutRef.current = window.setTimeout(() => {
      setFlash(false);
    }, 220);

    if (navigator.vibrate) {
      navigator.vibrate(25);
    }
  }, []);

  const enqueueCrystalTx = useCallback(() => {
    if (!isConnected || !sendTransactionAsync) {
      return;
    }

    const to = TX_CONFIG.recipient || address;
    if (!to) {
      return;
    }

    setPendingTxCount((current) => current + 1);
    txQueueRef.current = txQueueRef.current
      .then(() =>
        sendTransactionAsync({
          to,
          value: 0n,
          chainId: base.id,
        })
      )
      .then((hash) => {
        setLastTxHash(hash);
      })
      .catch((error) => {
        console.error("Crystal tx failed", error);
        setStatus("Onchain proof failed. Tap again to retry.");
      })
      .finally(() => {
        setPendingTxCount((current) => Math.max(0, current - 1));
      });
  }, [address, isConnected, sendTransactionAsync]);

  const spawnCrystals = useCallback(() => {
    setCrystals((current) => {
      if (current.length >= GAME_CONFIG.maxCrystals) {
        return current;
      }

      const spawnCount = Math.min(
        GAME_CONFIG.spawnBurstMax,
        GAME_CONFIG.maxCrystals - current.length
      );
      const nextCrystals = [...current];
      const taken = new Set(
        nextCrystals.map((crystal) => `${crystal.x}-${crystal.y}`)
      );
      taken.add(`${runner.x}-${runner.y}`);

      for (let i = 0; i < spawnCount; i += 1) {
        let attempts = 0;
        while (attempts < 24) {
          const x = Math.floor(Math.random() * GAME_CONFIG.gridSize);
          const y = Math.floor(Math.random() * GAME_CONFIG.gridSize);
          const key = `${x}-${y}`;
          attempts += 1;

          if (!taken.has(key)) {
            taken.add(key);
            nextCrystals.push({ x, y, id: makeId() });
            break;
          }
        }
      }

      return nextCrystals;
    });
  }, [runner.x, runner.y]);

  useEffect(() => {
    if (!hasStarted) {
      return;
    }

    spawnCrystals();
  }, [hasStarted, spawnCrystals]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      setRunner((current) => {
        const vector = directionRef.current;
        const delta = directionVectors[vector];
        const next = { x: current.x + delta.x, y: current.y + delta.y };

        if (
          next.x < 0 ||
          next.y < 0 ||
          next.x >= GAME_CONFIG.gridSize ||
          next.y >= GAME_CONFIG.gridSize
        ) {
          return current;
        }

        const hitIndex = crystalsRef.current.findIndex(
          (crystal) => crystal.x === next.x && crystal.y === next.y
        );

        if (hitIndex >= 0) {
          setCrystals((prev) =>
            prev.filter((crystal) => crystal.id !== crystalsRef.current[hitIndex].id)
          );
          setScore((prev) => prev + 1);
          triggerFlash();
          enqueueCrystalTx();
        }

        return next;
      });
    }, GAME_CONFIG.moveIntervalMs);

    return () => window.clearInterval(interval);
  }, [enqueueCrystalTx, isRunning, triggerFlash]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      setTimeLeft((current) => {
        if (current <= 1) {
          endGame();
          return 0;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [endGame, isRunning]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const interval = window.setInterval(() => {
      spawnCrystals();
    }, GAME_CONFIG.spawnIntervalMs);

    return () => window.clearInterval(interval);
  }, [isRunning, spawnCrystals]);

  useEffect(() => {
    if (!isRunning) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") setDirection("up");
      if (event.key === "ArrowDown") setDirection("down");
      if (event.key === "ArrowLeft") setDirection("left");
      if (event.key === "ArrowRight") setDirection("right");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isRunning]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const threshold = 24;

    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      setDirection(dx > 0 ? "right" : "left");
    } else {
      setDirection(dy > 0 ? "down" : "up");
    }
  };

  const preferredConnector = useMemo(() => {
    const miniAppConnector = connectors.find(
      (connector) => connector.id === "farcasterMiniApp"
    );
    const injectedConnector = connectors.find(
      (connector) => connector.id === "injected"
    );
    if (isReady && miniAppConnector) {
      return miniAppConnector;
    }
    return injectedConnector ?? connectors[0];
  }, [connectors, isReady]);

  const formattedTime = useMemo(() => {
    const minutes = Math.floor(timeLeft / 60);
    const seconds = timeLeft % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }, [timeLeft]);

  const cellSize = useMemo(
    () => `${100 / GAME_CONFIG.gridSize}%`,
    []
  );

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.userInfo}>
          <p className={styles.title}>Crystal Runner</p>
          <p className={styles.subtitle}>
            {context?.user?.displayName
              ? `Welcome, ${context.user.displayName}`
              : "Arcade onchain runner"}
          </p>
        </div>
        <div className={styles.status}>
          <span className={styles.statusLabel}>Time</span>
          <span className={styles.statusValue}>{formattedTime}</span>
        </div>
        <div className={styles.status}>
          <span className={styles.statusLabel}>Crystals</span>
          <span className={styles.statusValue}>{score}</span>
        </div>
      </header>

      <div className={styles.walletRow}>
        <div className={styles.walletStatus}>
          <span className={styles.walletDot} data-ready={isConnected} />
          <span>{status}</span>
        </div>
        {!isConnected && (
          <button
            className={styles.walletButton}
            onClick={() =>
              preferredConnector && connect({ connector: preferredConnector })
            }
            disabled={!preferredConnector || isConnecting}
            type="button"
          >
            {isConnecting ? "Connecting..." : "Connect wallet"}
          </button>
        )}
      </div>

      <div
        className={`${styles.board} ${flash ? styles.flash : ""}`}
        style={{ ["--cell" as string]: cellSize }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className={styles.runner}
          style={{
            width: cellSize,
            height: cellSize,
            transform: `translate(${runner.x * 100}%, ${runner.y * 100}%)`,
          }}
        />
        {crystals.map((crystal) => (
          <div
            key={crystal.id}
            className={styles.crystal}
            style={{
              width: cellSize,
              height: cellSize,
              transform: `translate(${crystal.x * 100}%, ${crystal.y * 100}%)`,
            }}
          />
        ))}

        {!hasStarted && (
          <div className={styles.overlay}>
            <div className={styles.overlayCard}>
              <h2>Ready to run?</h2>
              <p>Collect crystals for onchain proof of play.</p>
              <button onClick={startGame} className={styles.primaryButton}>
                Start round
              </button>
            </div>
          </div>
        )}

        {isGameOver && (
          <div className={styles.overlay}>
            <div className={styles.overlayCard}>
              <h2>Round complete</h2>
              <p className={styles.resultScore}>
                {score} crystals collected
              </p>
              <button onClick={startGame} className={styles.primaryButton}>
                Play again
              </button>
            </div>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.controlButton}
          onClick={() => setDirection("up")}
          disabled={!isRunning}
        >
          ↑
        </button>
        <div className={styles.controlRow}>
          <button
            type="button"
            className={styles.controlButton}
            onClick={() => setDirection("left")}
            disabled={!isRunning}
          >
            ←
          </button>
          <button
            type="button"
            className={styles.controlButton}
            onClick={() => setDirection("down")}
            disabled={!isRunning}
          >
            ↓
          </button>
          <button
            type="button"
            className={styles.controlButton}
            onClick={() => setDirection("right")}
            disabled={!isRunning}
          >
            →
          </button>
        </div>
      </div>

      <footer className={styles.footer}>
        <span>Round: {GAME_CONFIG.roundSeconds / 60} min</span>
        <span>Network: Base</span>
      </footer>
    </div>
  );
}
