/**
 * Every string the user reads.
 *
 * House style: short. Someone standing at a pump does not want three balanced
 * sentences where one blunt one will do. Prefer fragments for labels and hints,
 * cut every word that only adds politeness, and never write three clauses when
 * two carry the meaning.
 *
 * No em or en dashes anywhere. They do not survive being pasted around, and a
 * page full of them reads as machine written.
 */

export type Lang = 'ur' | 'en';

export const LANGS: { code: Lang; label: string; dir: 'rtl' | 'ltr' }[] = [
  { code: 'ur', label: 'اردو', dir: 'rtl' },
  { code: 'en', label: 'English', dir: 'ltr' },
];

export interface Strings {
  appName: string;
  tagline: string;
  intro: string;

  notOfficialTitle: string;
  notOfficial: string;
  privacy: string;

  stepDetails: string;

  cnicLabel: string;
  cnicHelp: string;
  cnicNotFromPaper: string;
  plateLabel: string;
  provinceLabel: string;
  dateLabel: string;

  scanButton: string;
  scanTitle: string;
  scanInstruction: string;
  scanCapture: string;
  torchOn: string;
  torchOff: string;
  scanCancel: string;
  scanWorking: string;
  scanFailedTitle: string;
  scanFailedBody: string;
  scanFoundTitle: string;
  scanCompare: string;
  scanUncertain: string;
  scanUse: string;
  scanRetake: string;
  scanNoCamera: string;
  scanChooseFile: string;
  scanNeverCnic: string;
  scanNicFound: string;
  scanNicWarning: string;
  scanNicUse: string;
  scanNicTypeInstead: string;
  scanDownload: string;
  scanHintEmpty: string;
  scanHintBlurry: string;
  scanHintMoving: string;
  scanHintReady: string;
  scanAutoGaveUp: string;
  scanCtaTitle: string;
  scanCtaBody: string;
  scanOrType: string;

  dateHelpTitle: string;
  dateHelpSms: string;
  dateHelpSmsButton: string;
  dateHelpExciseLink: string;

  ifItFails: string;
  previewTitle: string;
  previewIncomplete: string;
  missingTitle: string;
  openSms: string;
  smsDidNotOpen: string;
  copy: string;
  copied: string;
  sendTo: string;

  tokTitle: string;
  tokBody: string;
  tokButton: string;

  errors: Record<string, string>;
  footer: string;
}

const en: Strings = {
  appName: 'Sahi SMS',
  tagline: 'Writes your 9771 registration message',
  intro: 'Registration is one SMS to 9771. One wrong character and it fails.',

  notOfficialTitle: 'Not a government site',
  notOfficial:
    'No connection to any government department. Registration is free. Do not pay anyone for it.',
  privacy:
    'Nothing you type or photograph leaves your phone. No account, and none of it is saved anywhere. The page counts anonymous visits, with no cookies and nothing that identifies you.',

  stepDetails: 'Your details',

  cnicLabel: 'CNIC number',
  cnicHelp:
    'Must be the CNIC your SIM is registered to. 9771 checks the two against telecom records and fails if they do not match.',
  cnicNotFromPaper:
    'The NIC printed on the certificate is the registered owner’s. Use it only if the owner is you.',
  plateLabel: 'Number plate',
  provinceLabel: 'Registered in',
  dateLabel: 'Registration date',

  scanButton: 'Open camera',
  scanTitle: 'Scan the certificate',
  scanInstruction: 'Put the top line, the one with the plate and date, inside the box.',
  scanCapture: 'Take photo',
  torchOn: 'Turn the light on',
  torchOff: 'Turn the light off',
  scanCancel: 'Close',
  scanWorking: 'Reading',
  scanFailedTitle: 'Could not read it',
  scanFailedBody: 'More light, paper flat, try again. Or type the two fields yourself.',
  scanFoundTitle: 'Check these against the paper',
  scanCompare: 'What the camera read',
  scanUncertain: 'Check this one',
  scanUse: 'Correct',
  scanRetake: 'Again',
  scanNoCamera: 'No camera in this browser',
  scanChooseFile: 'Pick a photo instead',
  scanNeverCnic:
    'The plate and date are read from the paper. The CNIC is not, unless you tick the box and confirm it is yours.',
  scanNicFound: 'CNIC printed on the certificate',
  scanNicWarning:
    'This is the registered owner’s CNIC. 9771 only accepts the CNIC that your own SIM is registered to, so use this only if the owner is you. On a motorcycle it often is not.',
  scanNicUse: 'This is my CNIC and my SIM is registered to it',
  scanNicTypeInstead: 'Leave it unticked and type your own CNIC on the form instead.',
  scanDownload:
    'The first scan downloads the reader, about 15 MB, then keeps it. Your photo is not part of that.',
  scanHintEmpty: 'Point at the line with the plate and date',
  scanHintBlurry: 'Move back until the text is sharp',
  scanHintMoving: 'Hold still',
  scanHintReady: 'Got it',
  scanAutoGaveUp: 'Could not read it by itself. Press the button, or type it in.',
  scanCtaTitle: 'Scan the certificate',
  scanCtaBody:
    'Hold the camera over the line with your plate and date. It shoots by itself once it can read it.',
  scanOrType: 'or type it below',

  dateHelpTitle: 'Do not know the date?',
  dateHelpSms:
    'Text your plate to 8785. Excise sends back the vehicle details, including the registration date. Not every province supports it.',
  dateHelpSmsButton: 'Text plate to 8785',
  dateHelpExciseLink: 'Check on the excise site',

  ifItFails:
    'If it fails, check every character before sending again. Repeated bad tries lock your number for 24 hours. A car can only be registered by its owner.',
  previewTitle: 'Your message',
  previewIncomplete: 'Fill the boxes above.',
  missingTitle: 'Still missing',
  openSms: 'Open in Messages',
  smsDidNotOpen:
    'Nothing opened? Some browsers block it, especially inside WhatsApp or Facebook. Tap Copy, then paste it into a new message to 9771.',
  copy: 'Copy',
  copied: 'Copied',
  sendTo: 'To 9771',

  tokTitle: 'Getting petrol',
  tokBody: 'Send TOK to 9771, then show the token at the pump.',
  tokButton: 'Send TOK',

  errors: {
    'cnic.required': 'Enter your CNIC.',
    'cnic.tooShort': 'A CNIC has 13 digits.',
    'cnic.tooLong': 'A CNIC has 13 digits.',
    'cnic.invalid': 'That is not a CNIC number.',
    'plate.required': 'Enter your number plate.',
    'plate.invalid': 'That is not a number plate.',
    'province.required': 'Pick the province.',
    'province.invalid': 'Pick the province.',
    'date.required': 'Enter the registration date.',
    'date.unparseable': 'Day, month, year. Like 01/01/2020.',
    'date.day': 'No such day.',
    'date.month': 'No such month.',
    'date.year': 'Check the year.',
    'date.future': 'That date has not happened yet.',
    'date.impossible': 'No such date.',
    'date.ambiguous': 'Check the day and month are the right way round.',
  },

  footer: 'Independent and free. Registration through 9771 costs nothing.',
};

const ur: Strings = {
  appName: 'صحیح ایس ایم ایس',
  tagline: '9771 والا رجسٹریشن پیغام بنا دیتا ہے',
  intro: 'رجسٹریشن 9771 پر ایک ایس ایم ایس سے ہوتی ہے۔ ایک حرف غلط ہو تو ناکام۔',

  notOfficialTitle: 'یہ سرکاری سائٹ نہیں',
  notOfficial: 'کسی سرکاری ادارے سے تعلق نہیں۔ رجسٹریشن مفت ہے۔ اس کے لیے کسی کو پیسے نہ دیں۔',
  privacy:
    'آپ جو لکھتے یا تصویر کھینچتے ہیں، وہ فون سے باہر نہیں جاتا۔ نہ اکاؤنٹ ہے، نہ کچھ محفوظ ہوتا ہے۔ صفحہ صرف گمنام وزٹ گنتا ہے، نہ کوکیز، نہ کوئی شناخت۔',

  stepDetails: 'آپ کی تفصیل',

  cnicLabel: 'شناختی کارڈ نمبر',
  cnicHelp:
    'وہی شناختی کارڈ نمبر جس پر یہ سم رجسٹرڈ ہے۔ 9771 دونوں کو ٹیلی کام ریکارڈ سے ملاتا ہے، اور نہ ملیں تو ناکام ہو جاتا ہے۔',
  cnicNotFromPaper:
    'سرٹیفکیٹ پر لکھا NIC نہیں۔ وہ رجسٹرڈ مالک کا ہوتا ہے، جو اکثر کوئی اور ہوتا ہے۔',
  plateLabel: 'نمبر پلیٹ',
  provinceLabel: 'کس صوبے میں رجسٹرڈ ہے',
  dateLabel: 'رجسٹریشن کی تاریخ',

  scanButton: 'کیمرہ کھولیں',
  scanTitle: 'سرٹیفکیٹ اسکین کریں',
  scanInstruction: 'سب سے اوپر والی سطر، جس میں پلیٹ اور تاریخ ہے، ڈبے کے اندر رکھیں۔',
  scanCapture: 'تصویر لیں',
  torchOn: 'روشنی جلائیں',
  torchOff: 'روشنی بند کریں',
  scanCancel: 'بند کریں',
  scanWorking: 'پڑھا جا رہا ہے',
  scanFailedTitle: 'پڑھا نہیں جا سکا',
  scanFailedBody: 'زیادہ روشنی، کاغذ سیدھا، دوبارہ کوشش کریں۔ یا دونوں خانے خود لکھ لیں۔',
  scanFoundTitle: 'انہیں کاغذ سے ملا لیں',
  scanCompare: 'کیمرے نے یہ پڑھا',
  scanUncertain: 'اسے جانچ لیں',
  scanUse: 'درست ہیں',
  scanRetake: 'دوبارہ',
  scanNoCamera: 'اس براؤزر میں کیمرہ نہیں',
  scanChooseFile: 'اس کے بجائے تصویر منتخب کریں',
  scanNeverCnic:
    'پلیٹ اور تاریخ کاغذ سے پڑھی جاتی ہے۔ شناختی کارڈ نمبر نہیں، جب تک آپ خانے پر نشان لگا کر تصدیق نہ کریں کہ وہ آپ کا ہے۔',
  scanNicFound: 'سرٹیفکیٹ پر لکھا شناختی کارڈ نمبر',
  scanNicWarning:
    'یہ رجسٹرڈ مالک کا شناختی کارڈ نمبر ہے۔ 9771 صرف وہی نمبر قبول کرتا ہے جس پر آپ کی اپنی سم رجسٹرڈ ہے، اس لیے یہ تب استعمال کریں جب مالک آپ خود ہوں۔ موٹر سائیکل پر اکثر ایسا نہیں ہوتا۔',
  scanNicUse: 'یہ میرا شناختی کارڈ نمبر ہے اور میری سم اسی پر رجسٹرڈ ہے',
  scanNicTypeInstead: 'نشان نہ لگائیں اور اپنا شناختی کارڈ نمبر فارم میں خود لکھ لیں۔',
  scanDownload:
    'پہلی بار پڑھنے والا سافٹ ویئر ڈاؤن لوڈ ہوتا ہے، تقریباً 15 ایم بی، پھر محفوظ رہتا ہے۔ آپ کی تصویر اس میں شامل نہیں۔',
  scanHintEmpty: 'پلیٹ اور تاریخ والی سطر پر رکھیں',
  scanHintBlurry: 'تھوڑا پیچھے کریں تاکہ لکھائی صاف ہو',
  scanHintMoving: 'ساکن رکھیں',
  scanHintReady: 'مل گیا',
  scanAutoGaveUp: 'خود سے نہیں پڑھ سکا۔ بٹن دبائیں، یا خود لکھ لیں۔',
  scanCtaTitle: 'سرٹیفکیٹ اسکین کریں',
  scanCtaBody:
    'کیمرہ پلیٹ اور تاریخ والی سطر پر رکھیں۔ پڑھتے ہی خود تصویر لے لے گا۔',
  scanOrType: 'یا نیچے خود لکھ لیں',

  dateHelpTitle: 'تاریخ معلوم نہیں؟',
  dateHelpSms:
    'اپنی پلیٹ 8785 پر بھیجیں۔ ایکسائز گاڑی کی تفصیل واپس بھیجتا ہے، جس میں رجسٹریشن کی تاریخ بھی ہوتی ہے۔ ہر صوبے میں نہیں چلتا۔',
  dateHelpSmsButton: 'پلیٹ 8785 پر بھیجیں',
  dateHelpExciseLink: 'ایکسائز کی سائٹ پر دیکھیں',

  ifItFails:
    'ناکام ہو تو دوبارہ بھیجنے سے پہلے ہر حرف جانچ لیں۔ بار بار غلط کوشش پر نمبر 24 گھنٹے بلاک ہو جاتا ہے۔ کار صرف اس کا مالک رجسٹر کرا سکتا ہے۔',
  previewTitle: 'آپ کا پیغام',
  previewIncomplete: 'اوپر والے خانے بھر دیں۔',
  missingTitle: 'ابھی باقی ہے',
  openSms: 'پیغامات میں کھولیں',
  smsDidNotOpen:
    'کچھ نہیں کھلا؟ کچھ براؤزر اسے روک دیتے ہیں، خاص طور پر واٹس ایپ یا فیس بک کے اندر۔ کاپی دبائیں اور 9771 کو نئے پیغام میں پیسٹ کر دیں۔',
  copy: 'کاپی',
  copied: 'کاپی ہو گیا',
  sendTo: '9771 پر',

  tokTitle: 'پٹرول لینا',
  tokBody: '9771 پر TOK بھیجیں، پھر پمپ پر ٹوکن دکھائیں۔',
  tokButton: 'TOK بھیجیں',

  errors: {
    'cnic.required': 'شناختی کارڈ نمبر لکھیں۔',
    'cnic.tooShort': 'شناختی کارڈ نمبر 13 ہندسوں کا ہوتا ہے۔',
    'cnic.tooLong': 'شناختی کارڈ نمبر 13 ہندسوں کا ہوتا ہے۔',
    'cnic.invalid': 'یہ شناختی کارڈ نمبر نہیں۔',
    'plate.required': 'نمبر پلیٹ لکھیں۔',
    'plate.invalid': 'یہ نمبر پلیٹ نہیں۔',
    'province.required': 'صوبہ منتخب کریں۔',
    'province.invalid': 'صوبہ منتخب کریں۔',
    'date.required': 'رجسٹریشن کی تاریخ لکھیں۔',
    'date.unparseable': 'دن، مہینہ، سال۔ جیسے 01/01/2020۔',
    'date.day': 'ایسا دن نہیں۔',
    'date.month': 'ایسا مہینہ نہیں۔',
    'date.year': 'سال دیکھ لیں۔',
    'date.future': 'یہ تاریخ ابھی آئی نہیں۔',
    'date.impossible': 'ایسی تاریخ نہیں۔',
    'date.ambiguous': 'دیکھ لیں کہ دن اور مہینہ اپنی جگہ پر ہیں۔',
  },

  footer: 'آزاد اور مفت۔ 9771 سے رجسٹریشن کا کوئی خرچ نہیں۔',
};

export const STRINGS: Record<Lang, Strings> = { ur, en };

export function dirFor(lang: Lang): 'rtl' | 'ltr' {
  return lang === 'ur' ? 'rtl' : 'ltr';
}
