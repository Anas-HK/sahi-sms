import type { ProvinceCode } from './format';

export interface Province {
  code: ProvinceCode;
  en: string;
  /** Short form for the one-tap chip row, where space is tight. */
  enShort: string;
  ur: string;
  /**
   * Official excise vehicle-verification page, or null when we could not
   * confirm a working one. Never ship a guessed link: a dead link on a page
   * about a government scheme reads as a scam.
   *
   * Reachability checked 2026-09-23. Re-check before each deploy.
   */
  verifyUrl: string | null;
}

export const PROVINCES: Province[] = [
  {
    code: 'S',
    en: 'Sindh',
    enShort: 'Sindh',
    ur: 'سندھ',
    verifyUrl: 'https://excise.gos.pk/online-services/vehicle-verification',
  },
  {
    code: 'P',
    en: 'Punjab',
    enShort: 'Punjab',
    ur: 'پنجاب',
    verifyUrl: 'https://mtmis.excise.punjab.gov.pk/',
  },
  {
    code: 'K',
    en: 'Khyber Pakhtunkhwa',
    enShort: 'KPK',
    ur: 'خیبر پختونخوا',
    verifyUrl: 'https://excise.kp.gov.pk/online-services',
  },
  {
    code: 'I',
    en: 'Islamabad (ICT)',
    enShort: 'Islamabad',
    ur: 'اسلام آباد',
    verifyUrl: 'https://islamabadexcise.gov.pk/',
  },
  { code: 'B', en: 'Balochistan',
    enShort: 'Balochistan', ur: 'بلوچستان', verifyUrl: null },
  { code: 'A', en: 'Azad Jammu & Kashmir',
    enShort: 'AJK', ur: 'آزاد جموں و کشمیر', verifyUrl: null },
  { code: 'G', en: 'Gilgit-Baltistan',
    enShort: 'GB', ur: 'گلگت بلتستان', verifyUrl: null },
];

export function findProvince(code: string | null | undefined): Province | undefined {
  if (!code) return undefined;
  return PROVINCES.find((p) => p.code === code);
}
