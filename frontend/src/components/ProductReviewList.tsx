'use client';

import { FaStar } from 'react-icons/fa';
import type { ProductReview } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/** The product page's customer reviews, each with its star rating and date. */
export default function ProductReviewList({ reviews }: { reviews: ProductReview[] }) {
  const { t, formatDate } = useI18n();

  return (
    <div className="card p-6">
      <h2 className="mb-6 text-xl font-semibold tracking-tight text-gray-900">{t("用户评价")}</h2>

      {reviews.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">
          {t("暂无评价")}</div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review) => (
            <div key={review.review_id} className="border-b border-gray-100 pb-4 last:border-0">
              <div className="flex items-center mb-2">
                <div className="w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 font-medium mr-3">
                  {review.username?.[0]}
                </div>
                <div>
                  <div className="font-medium">{review.username}</div>
                  <div className="flex items-center text-sm text-gray-500">
                    <div className="mr-2 flex text-amber-400" aria-label={t('{rating} 分', { rating: review.rating })}>
                      {[...Array(5)].map((_, i) => (
                        <FaStar
                          key={i}
                          className={`h-3.5 w-3.5 ${i < review.rating ? '' : 'text-gray-200'}`}
                          aria-hidden="true"
                        />
                      ))}
                    </div>
                    <span>{formatDate(review.created_at, true)}</span>
                  </div>
                </div>
              </div>
              <p className="text-gray-700 ml-13">{review.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
