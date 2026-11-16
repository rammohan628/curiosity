-- Reference schema for MySQL 8 (tables are created automatically by SQLAlchemy on startup)
CREATE DATABASE IF NOT EXISTS curiosity CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE curiosity;
CREATE TABLE users (
  id INT PRIMARY KEY AUTO_INCREMENT, name VARCHAR(120) NOT NULL, username VARCHAR(60) NOT NULL UNIQUE,
  role VARCHAR(10) NOT NULL,                                   -- admin | teacher | student
  password_hash VARCHAR(255) NOT NULL, active TINYINT(1) NOT NULL DEFAULT 1,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1, created_at DATETIME NOT NULL);
CREATE TABLE auth_tokens (
  id INT PRIMARY KEY AUTO_INCREMENT, user_id INT NOT NULL, token_hash CHAR(64) NOT NULL UNIQUE, expires_at DATETIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE activities (
  id INT PRIMARY KEY AUTO_INCREMENT, title VARCHAR(200) NOT NULL, description TEXT, duration_min INT NOT NULL,
  file_name VARCHAR(255) NOT NULL, openai_file_id VARCHAR(100) NOT NULL,
  state VARCHAR(12) NOT NULL DEFAULT 'scheduled',              -- scheduled | in_progress | stopped
  started_at DATETIME NULL, created_by INT NULL, created_at DATETIME NOT NULL, FOREIGN KEY (created_by) REFERENCES users(id));
CREATE TABLE chat_sessions (                                   -- one private conversation per student per activity
  id INT PRIMARY KEY AUTO_INCREMENT, activity_id INT NOT NULL, student_id INT NOT NULL, conversation_id VARCHAR(100),
  created_at DATETIME NOT NULL, UNIQUE (activity_id, student_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id), FOREIGN KEY (student_id) REFERENCES users(id));
CREATE TABLE messages (
  id INT PRIMARY KEY AUTO_INCREMENT, session_id INT NOT NULL, role VARCHAR(10) NOT NULL,   -- student | assistant
  content LONGTEXT NOT NULL, created_at DATETIME NOT NULL, INDEX (session_id), FOREIGN KEY (session_id) REFERENCES chat_sessions(id));
CREATE TABLE analyses (                                        -- cached AI review of a student's prompts
  id INT PRIMARY KEY AUTO_INCREMENT, session_id INT NOT NULL UNIQUE, msg_count INT NOT NULL, data LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL, FOREIGN KEY (session_id) REFERENCES chat_sessions(id));
CREATE TABLE usage_events (                                    -- every billable AI call, for the cost report
  id INT PRIMARY KEY AUTO_INCREMENT, activity_id INT NOT NULL, user_id INT NULL,   -- user_id NULL = class-level call
  kind VARCHAR(12) NOT NULL,                                   -- chat | analysis | summary
  model VARCHAR(60) NOT NULL, input_tokens INT NOT NULL, cached_tokens INT NOT NULL, output_tokens INT NOT NULL,
  cost DOUBLE NOT NULL, created_at DATETIME NOT NULL, INDEX (activity_id, user_id),
  FOREIGN KEY (activity_id) REFERENCES activities(id), FOREIGN KEY (user_id) REFERENCES users(id));
