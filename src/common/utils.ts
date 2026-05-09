export const VIETNAMESE_DIACRITICS_FROM =
  'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';
export const VIETNAMESE_DIACRITICS_TO =
  'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiioooooooooooooooooouuuuuuuuuuuyyyyyd';

export const toMoney = (value: unknown): number => Math.max(0, Math.trunc(Number(value) || 0));
