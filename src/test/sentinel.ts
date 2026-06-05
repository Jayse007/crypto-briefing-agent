import { checkSentinel } from '../sentinel.ts';

checkSentinel().then(console.log).catch(console.error);