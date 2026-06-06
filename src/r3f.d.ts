/// <reference types="@react-three/fiber" />

import '@react-three/fiber';

declare global {
  namespace JSX {
    interface IntrinsicElements extends ReactThreeFiber.IntrinsicElements {}
  }
}

export {};
