import 'client-only';

import { getFirestore } from 'firebase/firestore';
import { firebaseApp } from './firebaseClient';

export const firestoreDb = getFirestore(firebaseApp);
