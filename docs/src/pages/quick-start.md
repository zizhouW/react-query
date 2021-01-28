---
id: quick-start
title: Quick Start
---

This example very briefly illustrates the 3 core concepts of React Query:

- Queries
- Mutations
- Query Invalidation

```js
import {
  useQuery,
  useMutation,
  useQueryClient,
  createQuery,
  createQueryClient,
  QueryClientProvider,
} from 'react-query'
import { getTodos, postTodo } from '../my-api'

// Create a client
const queryClient = createQueryClient()

const todosQuery = createQuery({
  key: 'todos',
  fetch: getTodos,
})

const postTodoMutation = createMutation({
  key: 'postTodo',
  mutate: postTodo,
  onSuccess: () => {
    // Invalidate and refetch todos
    queryClient.invalidateQueries('todos')
  },
})

function App() {
  return (
    // Provide the client to your App
    <QueryClientProvider client={queryClient}>
      <Todos />
    </QueryClientProvider>
  )
}

function Todos() {
  const query = useQuery(todosQuery)
  const mutation = useMutation(postTodoMutation)

  return (
    <div>
      <ul>
        {query.data.map(todo => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>

      <button
        onClick={() => {
          mutation.mutate({
            id: Date.now(),
            title: 'Do Laundry',
          })
        }}
      >
        Add Todo
      </button>
    </div>
  )
}

render(<App />, document.getElementById('root'))
```

These three concepts make up most of the core functionality of React Query. The next sections of the documentation will go over each of these core concepts in great detail.
