import type { Card } from '../types';

const GRADIENTS = [
  'from-sapphire to-carolina',
  'from-prussian to-celadon',
  'from-celadon to-carolina',
  'from-sapphire to-celadon',
  'from-prussian to-sapphire',
  'from-carolina to-celadon',
  'from-prussian to-carolina',
  'from-celadon to-azure',
];

interface SeedDef {
  en: string; pt: string; phoneticBR: string; ipa: string;
  exampleEN: string; examplePT: string; emoji: string; category: string;
}

const SEED: SeedDef[] = [
  // ---- Essenciais / sobrevivência ----
  { en: 'Water', pt: 'Água', phoneticBR: 'uóra', ipa: '/ˈwɔːtər/', exampleEN: 'Can I have some water, please?', examplePT: 'Posso beber um pouco de água, por favor?', emoji: '💧', category: 'Essenciais' },
  { en: 'Food', pt: 'Comida', phoneticBR: 'fúd', ipa: '/fuːd/', exampleEN: 'Brazilian food is amazing.', examplePT: 'A comida brasileira é incrível.', emoji: '🍛', category: 'Essenciais' },
  { en: 'Hello', pt: 'Olá', phoneticBR: 'helôu', ipa: '/həˈloʊ/', exampleEN: 'Hello! How are you?', examplePT: 'Olá! Como você está?', emoji: '👋', category: 'Essenciais' },
  { en: 'Thank you', pt: 'Obrigado(a)', phoneticBR: 'thénk iú', ipa: '/ˈθæŋk juː/', exampleEN: 'Thank you very much!', examplePT: 'Muito obrigado!', emoji: '🙏', category: 'Essenciais' },
  { en: 'Please', pt: 'Por favor', phoneticBR: 'plíz', ipa: '/pliːz/', exampleEN: 'A coffee, please.', examplePT: 'Um café, por favor.', emoji: '☕', category: 'Essenciais' },
  { en: 'Sorry', pt: 'Desculpa', phoneticBR: 'sóri', ipa: '/ˈsɒri/', exampleEN: 'Sorry, I am late.', examplePT: 'Desculpa, estou atrasado.', emoji: '😅', category: 'Essenciais' },
  { en: 'Yes', pt: 'Sim', phoneticBR: 'iés', ipa: '/jes/', exampleEN: 'Yes, I speak English.', examplePT: 'Sim, eu falo inglês.', emoji: '✅', category: 'Essenciais' },
  { en: 'No', pt: 'Não', phoneticBR: 'nôu', ipa: '/noʊ/', exampleEN: 'No, thank you.', examplePT: 'Não, obrigado.', emoji: '🚫', category: 'Essenciais' },
  // ---- Casa ----
  { en: 'House', pt: 'Casa', phoneticBR: 'ráus', ipa: '/haʊs/', exampleEN: 'My house is near the beach.', examplePT: 'Minha casa é perto da praia.', emoji: '🏠', category: 'Casa' },
  { en: 'Bed', pt: 'Cama', phoneticBR: 'béd', ipa: '/bed/', exampleEN: 'I go to bed at 10pm.', examplePT: 'Vou para a cama às 22h.', emoji: '🛏️', category: 'Casa' },
  { en: 'Kitchen', pt: 'Cozinha', phoneticBR: 'kítchen', ipa: '/ˈkɪtʃɪn/', exampleEN: 'Mom is in the kitchen.', examplePT: 'Mamãe está na cozinha.', emoji: '🍳', category: 'Casa' },
  { en: 'Door', pt: 'Porta', phoneticBR: 'dór', ipa: '/dɔːr/', exampleEN: 'Close the door, please.', examplePT: 'Feche a porta, por favor.', emoji: '🚪', category: 'Casa' },
  { en: 'Window', pt: 'Janela', phoneticBR: 'uíndou', ipa: '/ˈwɪndoʊ/', exampleEN: 'Open the window.', examplePT: 'Abra a janela.', emoji: '🪟', category: 'Casa' },
  // ---- Comida ----
  { en: 'Apple', pt: 'Maçã', phoneticBR: 'épou', ipa: '/ˈæpəl/', exampleEN: 'An apple a day keeps the doctor away.', examplePT: 'Uma maçã por dia mantém o médico longe.', emoji: '🍎', category: 'Comida' },
  { en: 'Bread', pt: 'Pão', phoneticBR: 'bréd', ipa: '/bred/', exampleEN: 'I eat bread every morning.', examplePT: 'Como pão toda manhã.', emoji: '🍞', category: 'Comida' },
  { en: 'Cheese', pt: 'Queijo', phoneticBR: 'chíz', ipa: '/tʃiːz/', exampleEN: 'I love cheese bread (pão de queijo).', examplePT: 'Eu amo pão de queijo.', emoji: '🧀', category: 'Comida' },
  { en: 'Chicken', pt: 'Frango', phoneticBR: 'tchíquen', ipa: '/ˈtʃɪkɪn/', exampleEN: 'Grilled chicken with rice.', examplePT: 'Frango grelhado com arroz.', emoji: '🍗', category: 'Comida' },
  { en: 'Coffee', pt: 'Café', phoneticBR: 'cófi', ipa: '/ˈkɔːfi/', exampleEN: 'Brazilian coffee is the best.', examplePT: 'O café brasileiro é o melhor.', emoji: '☕', category: 'Comida' },
  // ---- Viagem ----
  { en: 'Airport', pt: 'Aeroporto', phoneticBR: 'érport', ipa: '/ˈerpɔːrt/', exampleEN: 'The airport is far from here.', examplePT: 'O aeroporto é longe daqui.', emoji: '✈️', category: 'Viagem' },
  { en: 'Ticket', pt: 'Passagem / Bilhete', phoneticBR: 'tíquêt', ipa: '/ˈtɪkɪt/', exampleEN: 'I bought two tickets.', examplePT: 'Comprei duas passagens.', emoji: '🎫', category: 'Viagem' },
  { en: 'Hotel', pt: 'Hotel', phoneticBR: 'houtél', ipa: '/hoʊˈtel/', exampleEN: 'Our hotel has a pool.', examplePT: 'Nosso hotel tem piscina.', emoji: '🏨', category: 'Viagem' },
  { en: 'Beach', pt: 'Praia', phoneticBR: 'bítch', ipa: '/biːtʃ/', exampleEN: 'Copacabana beach is famous.', examplePT: 'A praia de Copacabana é famosa.', emoji: '🏖️', category: 'Viagem' },
  { en: 'Map', pt: 'Mapa', phoneticBR: 'mép', ipa: '/mæp/', exampleEN: 'Can you show me on the map?', examplePT: 'Você pode me mostrar no mapa?', emoji: '🗺️', category: 'Viagem' },
  // ---- Verbos top ----
  { en: 'To eat', pt: 'Comer', phoneticBR: 'tu ít', ipa: '/tuː iːt/', exampleEN: 'I want to eat pizza.', examplePT: 'Quero comer pizza.', emoji: '🍕', category: 'Verbos' },
  { en: 'To drink', pt: 'Beber', phoneticBR: 'tu drínk', ipa: '/tuː drɪŋk/', exampleEN: 'I drink water every day.', examplePT: 'Bebo água todo dia.', emoji: '🥤', category: 'Verbos' },
  { en: 'To go', pt: 'Ir', phoneticBR: 'tu gôu', ipa: '/tuː ɡoʊ/', exampleEN: 'I go to work by bus.', examplePT: 'Vou ao trabalho de ônibus.', emoji: '🚌', category: 'Verbos' },
  { en: 'To speak', pt: 'Falar', phoneticBR: 'tu spík', ipa: '/tuː spiːk/', exampleEN: 'I speak Portuguese and English.', examplePT: 'Falo português e inglês.', emoji: '🗣️', category: 'Verbos' },
  { en: 'To learn', pt: 'Aprender', phoneticBR: 'tu lérn', ipa: '/tuː lɜːrn/', exampleEN: 'I learn English every day.', examplePT: 'Aprendo inglês todo dia.', emoji: '📚', category: 'Verbos' },
  { en: 'To work', pt: 'Trabalhar', phoneticBR: 'tu uórk', ipa: '/tuː wɜːrk/', exampleEN: 'She works from home.', examplePT: 'Ela trabalha de casa.', emoji: '💼', category: 'Verbos' },
  { en: 'To love', pt: 'Amar', phoneticBR: 'tu lâv', ipa: '/tuː lʌv/', exampleEN: 'I love my family.', examplePT: 'Eu amo minha família.', emoji: '❤️', category: 'Verbos' },
  { en: 'To need', pt: 'Precisar', phoneticBR: 'tu níd', ipa: '/tuː niːd/', exampleEN: 'I need help.', examplePT: 'Preciso de ajuda.', emoji: '🆘', category: 'Verbos' },
  // ---- Tempo / rotina ----
  { en: 'Morning', pt: 'Manhã', phoneticBR: 'mórnin', ipa: '/ˈmɔːrnɪŋ/', exampleEN: 'Good morning!', examplePT: 'Bom dia!', emoji: '🌅', category: 'Rotina' },
  { en: 'Night', pt: 'Noite', phoneticBR: 'náit', ipa: '/naɪt/', exampleEN: 'Good night!', examplePT: 'Boa noite!', emoji: '🌙', category: 'Rotina' },
  { en: 'Today', pt: 'Hoje', phoneticBR: 'tudêi', ipa: '/təˈdeɪ/', exampleEN: 'Today is a great day.', examplePT: 'Hoje é um ótimo dia.', emoji: '📅', category: 'Rotina' },
  { en: 'Tomorrow', pt: 'Amanhã', phoneticBR: 'tumórou', ipa: '/təˈmɔːroʊ/', exampleEN: 'See you tomorrow!', examplePT: 'Te vejo amanhã!', emoji: '🔜', category: 'Rotina' },
  // ---- Pessoas ----
  { en: 'Friend', pt: 'Amigo(a)', phoneticBR: 'frénd', ipa: '/frend/', exampleEN: 'He is my best friend.', examplePT: 'Ele é meu melhor amigo.', emoji: '🧑‍🤝‍🧑', category: 'Pessoas' },
  { en: 'Family', pt: 'Família', phoneticBR: 'fémeli', ipa: '/ˈfæməli/', exampleEN: 'My family is big.', examplePT: 'Minha família é grande.', emoji: '👨‍👩‍👧‍👦', category: 'Pessoas' },
  { en: 'Dog', pt: 'Cachorro', phoneticBR: 'dóg', ipa: '/dɔːɡ/', exampleEN: 'My dog is very friendly.', examplePT: 'Meu cachorro é muito amigável.', emoji: '🐶', category: 'Pessoas' },
  { en: 'Cat', pt: 'Gato', phoneticBR: 'két', ipa: '/kæt/', exampleEN: 'The cat is sleeping.', examplePT: 'O gato está dormindo.', emoji: '🐱', category: 'Pessoas' },
  // ---- Trabalho / tech ----
  { en: 'Computer', pt: 'Computador', phoneticBR: 'compiúra', ipa: '/kəmˈpjuːtər/', exampleEN: 'I work on my computer.', examplePT: 'Trabalho no meu computador.', emoji: '💻', category: 'Tech' },
  { en: 'Phone', pt: 'Telefone / Celular', phoneticBR: 'fôun', ipa: '/foʊn/', exampleEN: 'My phone is charging.', examplePT: 'Meu celular está carregando.', emoji: '📱', category: 'Tech' },
  { en: 'Money', pt: 'Dinheiro', phoneticBR: 'mâni', ipa: '/ˈmʌni/', exampleEN: 'I need to save money.', examplePT: 'Preciso guardar dinheiro.', emoji: '💰', category: 'Tech' },
  { en: 'Time', pt: 'Tempo / Hora', phoneticBR: 'táim', ipa: '/taɪm/', exampleEN: 'What time is it?', examplePT: 'Que horas são?', emoji: '⏰', category: 'Rotina' },
  // ---- Adjetivos úteis ----
  { en: 'Happy', pt: 'Feliz', phoneticBR: 'répi', ipa: '/ˈhæpi/', exampleEN: 'I am happy today.', examplePT: 'Estou feliz hoje.', emoji: '😄', category: 'Adjetivos' },
  { en: 'Beautiful', pt: 'Lindo(a)', phoneticBR: 'biúrifou', ipa: '/ˈbjuːtɪfəl/', exampleEN: 'Rio is a beautiful city.', examplePT: 'O Rio é uma cidade linda.', emoji: '🌆', category: 'Adjetivos' },
  { en: 'Big', pt: 'Grande', phoneticBR: 'bíg', ipa: '/bɪɡ/', exampleEN: 'An elephant is big.', examplePT: 'Um elefante é grande.', emoji: '🐘', category: 'Adjetivos' },
  { en: 'Small', pt: 'Pequeno(a)', phoneticBR: 'smól', ipa: '/smɔːl/', exampleEN: 'I live in a small town.', examplePT: 'Moro numa cidade pequena.', emoji: '🐭', category: 'Adjetivos' },
  { en: 'Fast', pt: 'Rápido', phoneticBR: 'fést', ipa: '/fæst/', exampleEN: 'This car is very fast.', examplePT: 'Este carro é muito rápido.', emoji: '🏎️', category: 'Adjetivos' },
  { en: 'Easy', pt: 'Fácil', phoneticBR: 'ízi', ipa: '/ˈiːzi/', exampleEN: 'English is easy with practice.', examplePT: 'Inglês é fácil com prática.', emoji: '👍', category: 'Adjetivos' },
];

let counter = 0;

export function buildSeedCards(now = Date.now()): Card[] {
  return SEED.map((s, i) => {
    counter += 1;
    return {
      id: `seed-${i}-${counter}`,
      ...s,
      gradient: GRADIENTS[i % GRADIENTS.length],
      pile: 'new' as const,
      box: 0,
      nextReviewAt: now,
      correctStreak: 0,
      seenCount: 0,
      createdAt: now - (SEED.length - i) * 1000,
    };
  });
}
