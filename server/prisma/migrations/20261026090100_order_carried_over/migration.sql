-- 1차(경기) 입금 확인 주문 중 세종 수령으로 옮긴 것은 1차 이월(carried_over)로 따로 관리한다.
INSERT INTO "OrderLog" ("orderId", "actor", "actorUserId", "fromStatus", "toStatus", "note", "createdAt")
  SELECT "id", 'admin', NULL, 'paid', 'carried_over', '1차 이월 상태로 분리', strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now') FROM "Order"
  WHERE "round" = 1 AND "event" <> 'inmufe' AND "status" = 'paid';
UPDATE "Order" SET "status" = 'carried_over' WHERE "round" = 1 AND "event" <> 'inmufe' AND "status" = 'paid';
