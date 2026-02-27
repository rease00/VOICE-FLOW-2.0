import { useCallback, useState } from 'react';
import {
  type AdminCoupon,
  createAdminCoupon,
  fetchAdminCoupons,
  patchAdminCoupon,
} from '../api/adminApi';

interface UseAdminCouponsArgs {
  baseUrl: string;
}

export const useAdminCoupons = ({ baseUrl }: UseAdminCouponsArgs) => {
  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [isLoadingCoupons, setIsLoadingCoupons] = useState(false);

  const reloadCoupons = useCallback(async (limit = 200) => {
    setIsLoadingCoupons(true);
    try {
      const rows = await fetchAdminCoupons(baseUrl, limit);
      setCoupons(rows);
      return rows;
    } finally {
      setIsLoadingCoupons(false);
    }
  }, [baseUrl]);

  return {
    coupons,
    isLoadingCoupons,
    reloadCoupons,
    createAdminCoupon: (input: Parameters<typeof createAdminCoupon>[0]) => createAdminCoupon(input, baseUrl),
    patchAdminCoupon: (couponId: string, patch: Parameters<typeof patchAdminCoupon>[1]) =>
      patchAdminCoupon(couponId, patch, baseUrl),
  };
};
