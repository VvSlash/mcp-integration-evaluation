DROP TABLE IF EXISTS orders;

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(120) NOT NULL,
    customer_email VARCHAR(160) NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled', 'refunded')),
    total_amount NUMERIC(10, 2) NOT NULL CHECK (total_amount >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'PLN',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_orders_customer_email ON orders(customer_email);

INSERT INTO orders (customer_name, customer_email, status, total_amount, currency, created_at) VALUES
('Anna Kowalska', 'anna.kowalska@example.com', 'paid', 249.99, 'PLN', '2026-01-10 10:15:00'),
('Jan Nowak', 'jan.nowak@example.com', 'pending', 89.50, 'PLN', '2026-01-11 12:40:00'),
('Marta Zielinska', 'marta.zielinska@example.com', 'shipped', 1399.00, 'PLN', '2026-01-12 09:20:00'),
('Piotr Wisniewski', 'piotr.wisniewski@example.com', 'cancelled', 59.99, 'PLN', '2026-01-13 16:05:00'),
('Ewa Wojcik', 'ewa.wojcik@example.com', 'paid', 749.00, 'PLN', '2026-01-14 14:30:00'),
('Tomasz Kaminski', 'tomasz.kaminski@example.com', 'refunded', 199.99, 'PLN', '2026-01-15 08:55:00'),
('Katarzyna Lewandowska', 'katarzyna.lewandowska@example.com', 'paid', 329.90, 'PLN', '2026-01-16 18:10:00'),
('Michal Dabrowski', 'michal.dabrowski@example.com', 'shipped', 459.00, 'PLN', '2026-01-17 11:45:00'),
('Agnieszka Mazur', 'agnieszka.mazur@example.com', 'pending', 129.99, 'PLN', '2026-01-18 13:25:00'),
('Pawel Krawczyk', 'pawel.krawczyk@example.com', 'paid', 999.99, 'PLN', '2026-01-19 17:35:00'),
('Monika Piotrowska', 'monika.piotrowska@example.com', 'cancelled', 79.00, 'PLN', '2026-01-20 19:00:00'),
('Grzegorz Grabowski', 'grzegorz.grabowski@example.com', 'shipped', 1549.49, 'PLN', '2026-01-21 07:50:00'),
('Natalia Pawlak', 'natalia.pawlak@example.com', 'paid', 299.00, 'PLN', '2026-01-22 15:15:00'),
('Adam Michalski', 'adam.michalski@example.com', 'pending', 44.99, 'PLN', '2026-01-23 09:05:00'),
('Karolina Nowicka', 'karolina.nowicka@example.com', 'refunded', 599.00, 'PLN', '2026-01-24 20:20:00');