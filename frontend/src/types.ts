export interface DiarizedWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker: number;
  punctuated_word: string;
}

export interface Utterance {
  speaker: number;
  text: string;
  start: number;
  end: number;
}
