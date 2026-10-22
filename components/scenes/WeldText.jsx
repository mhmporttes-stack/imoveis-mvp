import styles from "./scenes.module.css";

// Pseudoaleatório determinístico (mesma frase = mesmo voo em todo aparelho; nada de Math.random no render).
export function sceneRandom(n, salt = 12.9898) {
  const x = Math.sin(n * salt) * 43758.5453;
  return x - Math.floor(x);
}

// Monta o voo das letras: cada letra sai de um ponto, crava em `start + i*step` ms e é soldada `lag` ms depois.
// Devolve as palavras e o instante (ms) em que a última letra termina de esfriar — para o "boom" e o que vem depois.
export function weldLayout(text, { start = 600, step = 22, lag = 560, spreadX = 900, spreadY = 520, salt = 12.9898 } = {}) {
  let k = 0;
  const words = String(text || "").split(/\s+/).filter(Boolean).map((word) => [...word].map((ch) => {
    const i = k++;
    return {
      ch,
      style: {
        "--x": `${Math.round((sceneRandom(i + 1, salt) - 0.5) * spreadX)}px`,
        "--y": `${Math.round((sceneRandom(i + 7, salt) - 0.5) * spreadY)}px`,
        "--r": `${Math.round((sceneRandom(i + 3, salt) - 0.5) * 260)}deg`,
        "--d": `${start + i * step}ms`,
        "--lag": `${lag}ms`
      }
    };
  }));
  return { words, end: start + Math.max(0, k - 1) * step + lag + 800 };
}

// Texto com as letras soldadas. O texto real fica para leitores de tela no elemento pai (aria-label);
// as letras animadas são decorativas.
export default function WeldText({ layout }) {
  return layout.words.map((letters, w) => (
    <span key={w} className={styles.word} aria-hidden="true">
      {letters.map((item, i) => <span key={i} className={styles.letter} style={item.style}>{item.ch}</span>)}
    </span>
  ));
}
