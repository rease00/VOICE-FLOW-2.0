import { getFirebaseAdminFirestore } from '../firebaseAdmin';

const READER_LEGAL_ACK_COLLECTION = 'reader_legal_ack';
const memoryReaderLegalAck = new Map<string, ReaderLegalAckRecord>();

export const READER_BILLING_VF_PER_CHAR = 0.5;

export interface ReaderLegalAckRecord {
  uid: string;
  accepted: boolean;
  updatedAt: string;
  acceptedAt: string;
}

const getFirestoreHandle = () => {
  try {
    return getFirebaseAdminFirestore();
  } catch {
    return null;
  }
};

const emptyAck = (uid: string): ReaderLegalAckRecord => ({
  uid,
  accepted: false,
  updatedAt: '',
  acceptedAt: '',
});

export const getReaderLegalAck = async (uid: string): Promise<ReaderLegalAckRecord> => {
  const safeUid = String(uid || '').trim();
  if (!safeUid) {
    return emptyAck('');
  }

  const firestore = getFirestoreHandle();
  if (!firestore) {
    return memoryReaderLegalAck.get(safeUid) || emptyAck(safeUid);
  }

  try {
    const snapshot = await firestore.collection(READER_LEGAL_ACK_COLLECTION).doc(safeUid).get();
    if (!snapshot.exists) {
      return emptyAck(safeUid);
    }

    const payload = snapshot.data() as Partial<ReaderLegalAckRecord> | undefined;
    return {
      uid: safeUid,
      accepted: Boolean(payload?.accepted),
      updatedAt: String(payload?.updatedAt || ''),
      acceptedAt: String(payload?.acceptedAt || ''),
    };
  } catch {
    return emptyAck(safeUid);
  }
};

export const setReaderLegalAck = async (uid: string, accepted: boolean): Promise<ReaderLegalAckRecord> => {
  const safeUid = String(uid || '').trim();
  const nowIso = new Date().toISOString();
  const payload: ReaderLegalAckRecord = {
    uid: safeUid,
    accepted: Boolean(accepted),
    updatedAt: nowIso,
    acceptedAt: accepted ? nowIso : '',
  };

  const firestore = getFirestoreHandle();
  if (!firestore) {
    memoryReaderLegalAck.set(safeUid, payload);
    return payload;
  }

  await firestore.collection(READER_LEGAL_ACK_COLLECTION).doc(safeUid).set(payload, { merge: true });
  return payload;
};

export const buildReaderLegalAckEnvelope = (ack: ReaderLegalAckRecord) => ({
  ok: true,
  ack: {
    accepted: Boolean(ack.accepted),
    acceptedAt: String(ack.acceptedAt || ''),
    title: 'VoiceFlow Reader upload rights',
    message: 'Upload only work you created, have permission to use, or that is openly licensed. VoiceFlow does not claim ownership of your files, and you remain responsible for rights and misuse.',
  },
  billing: {
    vfPerChar: READER_BILLING_VF_PER_CHAR,
    rule: '1 char = 0.5 VF',
    label: 'Reader pricing: 1 char = 0.5 VF',
  },
});
