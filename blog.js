document.addEventListener('DOMContentLoaded', function() {
  const form = document.getElementById('blog-form');
  const postsDiv = document.getElementById('posts');

  function getPosts() {
    return JSON.parse(localStorage.getItem('blogPosts') || '[]');
  }

  function savePosts(posts) {
    localStorage.setItem('blogPosts', JSON.stringify(posts));
  }

  function renderPosts() {
    const posts = getPosts();
    postsDiv.innerHTML = '';
    posts.reverse().forEach(post => {
      const postEl = document.createElement('div');
      postEl.className = 'post';
      postEl.innerHTML = `<div class="post-title">${post.title}</div><div class="post-content">${post.content}</div>`;
      postsDiv.appendChild(postEl);
    });
  }

  form.addEventListener('submit', function(e) {
    e.preventDefault();
    const title = document.getElementById('post-title').value.trim();
    const content = document.getElementById('post-content').value.trim();
    if (title && content) {
      const posts = getPosts();
      posts.push({ title, content });
      savePosts(posts);
      form.reset();
      renderPosts();
    }
  });

  renderPosts();
}); 