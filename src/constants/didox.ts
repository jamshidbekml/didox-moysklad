/**
 * Didox document type codes → human-readable Russian names.
 * Source: Didox Partner API documentation.
 */
export const DOC_TYPES: Record<string, string> = {
  '000': 'Произвольный документ "Другое"',
  '001': 'Счёт-фактура',
  '002': 'Счёт-фактура без акта',
  '005': 'Акт выполненных работ',
  '006': 'Доверенность',
  '007': 'Договор (НК)',
  '008': 'Счёт-фактура (ФАРМ)',
  '010': 'Многосторонний произвольный документ',
  '023': 'Гибридная счёт-фактура',
  '031': 'Письмо НК',
  '041': 'ТТН (Товарно-транспортная накладная)',
  '052': 'Акт сверки',
  '054': 'Акт приёма-передачи',
  '075': 'Протокол собрания учредителей',
};

/**
 * Didox document status codes → display name + color slug.
 * The color slug is consumed by CSS via [data-color="..."] selectors on
 * .status-pill (list) and .status-badge (detail).
 */
export interface DidoxStatusInfo {
  name: string;
  color: 'white' | 'blue' | 'orange' | 'green' | 'black' | 'red' | 'gray';
}

export const STATUSES: Record<number, DidoxStatusInfo> = {
  0:  { name: 'Черновик',                 color: 'white'  },
  1:  { name: 'Ожидают подписи партнёра', color: 'blue'   },
  2:  { name: 'Ожидает вашей подписи',    color: 'orange' },
  3:  { name: 'Подписан',                 color: 'green'  },
  4:  { name: 'Отказ от подписи',         color: 'black'  },
  5:  { name: 'Удалён',                   color: 'red'    },
  55: { name: 'Черновик удалён',          color: 'red'    },
  40: { name: 'Недействительный',         color: 'gray'   },
  50: { name: 'Аннулирован НК',           color: 'gray'   },
  60: { name: 'Ожидают подписи агента',   color: 'blue'   },
};
