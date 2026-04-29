import { useOutlet } from 'react-router';
import { ReaderHandoffView } from './_shared';

export default function AppReaderRoute() {
  const outlet = useOutlet();
  return outlet ?? <ReaderHandoffView />;
}
